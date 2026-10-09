import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { formatDue, parseLocalDateTime, startOfLocalDay, toLocalInput } from "@/lib/dates";
import { createLead, DomainError, moveStage, setAssignee } from "@/lib/domain/leads";
import { bucketOf, countUrgentTasks, createTask, findDueTasks, listTasks, setTaskDone } from "@/lib/domain/tasks";
import { executeTool } from "@/lib/ai/tools";
import { executive, seedFunnel } from "./factories";

const HOUR = 3_600_000;

describe("fechas en hora de Chile", () => {
  it("interpreta la hora local con su desfase de invierno y de verano", () => {
    // Julio: UTC-4. Diciembre: UTC-3.
    expect(parseLocalDateTime("2026-07-15 10:00")!.toISOString()).toBe("2026-07-15T14:00:00.000Z");
    expect(parseLocalDateTime("2026-12-15T10:00")!.toISOString()).toBe("2026-12-15T13:00:00.000Z");
    expect(parseLocalDateTime("2026-12-15")!.toISOString()).toBe("2026-12-15T21:00:00.000Z");
    expect(toLocalInput(new Date("2026-07-15T14:00:00Z"))).toBe("2026-07-15T10:00");
  });

  it("rechaza fechas inválidas", () => {
    expect(parseLocalDateTime("mañana")).toBeNull();
    expect(parseLocalDateTime("2026-02-30 10:00")).toBeNull();
    expect(parseLocalDateTime("2026-02-10 25:00")).toBeNull();
  });

  it("separa vencidas, de hoy y próximas según la medianoche de Chile", () => {
    const now = new Date("2026-07-15T14:00:00Z"); // 10:00 en Chile
    expect(startOfLocalDay(now, 1).toISOString()).toBe("2026-07-16T04:00:00.000Z");
    expect(bucketOf(new Date(now.getTime() - HOUR), now)).toBe("overdue");
    expect(bucketOf(parseLocalDateTime("2026-07-15 23:30")!, now)).toBe("today");
    expect(bucketOf(parseLocalDateTime("2026-07-16 00:30")!, now)).toBe("upcoming");
    expect(formatDue(new Date(now.getTime() - 2 * HOUR), now)).toBe("Venció hace 2 h");
    expect(formatDue(parseLocalDateTime("2026-07-16 10:00")!, now)).toMatch(/^Mañana 10:00/);
  });
});

describe("tareas", () => {
  it("una tarea nueva queda para el ejecutivo del lead y deja registro", async () => {
    await seedFunnel();
    const ana = await executive("Ana");
    const lead = await createLead({ name: "Cliente", channel: "SIMULATOR" });
    await setAssignee(lead.id, ana.id, { actor: "SYSTEM" });

    const task = await createTask(lead.id, { title: " Llamar ", dueAt: new Date(Date.now() + HOUR) }, { actor: "USER", userId: ana.id });
    expect(task).toMatchObject({ title: "Llamar", assigneeId: ana.id, createdBy: "USER", completedAt: null });
    const event = await db.leadEvent.findFirstOrThrow({ where: { leadId: lead.id, type: "TASK_CREATED" } });
    expect(event.data).toMatchObject({ title: "Llamar", assigneeName: "Ana" });

    await expect(createTask(lead.id, { title: " ", dueAt: new Date() }, { actor: "USER" })).rejects.toThrow(DomainError);
  });

  it("al cambiar de ejecutivo, las tareas pendientes lo siguen (las cumplidas y las de otros no)", async () => {
    await seedFunnel();
    const [ana, beto, carla] = [await executive("Ana"), await executive("Beto"), await executive("Carla")];
    const lead = await createLead({ name: "Cliente", channel: "SIMULATOR" });
    const due = new Date(Date.now() + HOUR);
    const unassigned = await createTask(lead.id, { title: "Sin dueño", dueAt: due }, { actor: "AI" });
    await setAssignee(lead.id, ana.id, { actor: "SYSTEM" });
    const ofAna = await createTask(lead.id, { title: "De Ana", dueAt: due }, { actor: "AI" });
    const doneTask = await createTask(lead.id, { title: "Hecha", dueAt: due }, { actor: "AI" });
    await setTaskDone(doneTask.id, true, { actor: "USER", userId: ana.id });
    const ofCarla = await createTask(lead.id, { title: "De Carla", dueAt: due, assigneeId: carla.id }, { actor: "USER" });

    await setAssignee(lead.id, beto.id, { actor: "SYSTEM" });

    const owner = async (id: string) => (await db.task.findUniqueOrThrow({ where: { id } })).assigneeId;
    expect(await owner(unassigned.id)).toBe(beto.id);
    expect(await owner(ofAna.id)).toBe(beto.id);
    expect(await owner(doneTask.id)).toBe(ana.id);
    expect(await owner(ofCarla.id)).toBe(carla.id);
  });

  it("las tareas sin ejecutivo pasan a quien asignen las reglas", async () => {
    const stages = await seedFunnel();
    const ana = await executive("Ana");
    const lead = await createLead({ name: "Cliente", channel: "SIMULATOR" });
    const task = await createTask(lead.id, { title: "Llamar", dueAt: new Date(Date.now() + HOUR) }, { actor: "AI" });
    await moveStage(lead.id, stages[3].id, { actor: "AI" }); // atención humana: asigna al de menor carga
    expect((await db.task.findUniqueOrThrow({ where: { id: task.id } })).assigneeId).toBe(ana.id);
  });

  it("Mis tareas agrupa por plazo, cuenta las urgentes y entrega las por vencer", async () => {
    await seedFunnel();
    const ana = await executive("Ana");
    const lead = await createLead({ name: "Cliente", channel: "SIMULATOR" });
    await setAssignee(lead.id, ana.id, { actor: "SYSTEM" });
    const now = new Date();
    const by = { actor: "USER" as const, userId: ana.id };
    await createTask(lead.id, { title: "Vencida", dueAt: new Date(now.getTime() - HOUR) }, by);
    await createTask(lead.id, { title: "Próxima", dueAt: startOfLocalDay(now, 3) }, by);
    const done = await createTask(lead.id, { title: "Hecha", dueAt: new Date(now.getTime() - HOUR) }, by);
    await setTaskDone(done.id, true, by);

    const tasks = await listTasks(ana.id, now);
    expect(tasks.overdue.map((t) => t.title)).toEqual(["Vencida"]);
    expect(tasks.upcoming.map((t) => t.title)).toEqual(["Próxima"]);
    expect(tasks.done.map((t) => t.title)).toEqual(["Hecha"]);
    expect((await listTasks(null, now)).overdue).toHaveLength(0);
    expect(await countUrgentTasks(ana.id, now)).toBe(1);

    const due = await findDueTasks(now);
    expect(due.map((t) => [t.title, t.assignee?.email, t.lead.contact.name])).toEqual([["Vencida", "ana@test.cl", "Cliente"]]);
    expect(await findDueTasks(now, now)).toHaveLength(0);
  });
});

describe("herramienta create_task de la IA", () => {
  it("crea la tarea en hora de Chile para el ejecutivo del lead", async () => {
    await seedFunnel();
    const ana = await executive("Ana");
    const lead = await createLead({ name: "Cliente", channel: "SIMULATOR" });
    await setAssignee(lead.id, ana.id, { actor: "SYSTEM" });
    const due = toLocalInput(startOfLocalDay(new Date(), 2)).slice(0, 10) + " 10:00";

    const outcome = await executeTool(lead.id, "create_task", { title: "Enviar masterplan", due, notes: "Proyecto Ovalle" });
    expect(outcome).toEqual({ content: 'Tarea creada para Ana: "Enviar masterplan".' });
    const task = await db.task.findFirstOrThrow({ where: { leadId: lead.id } });
    expect(task).toMatchObject({ createdBy: "AI", assigneeId: ana.id, notes: "Proyecto Ovalle" });
    expect(toLocalInput(task.dueAt).replace("T", " ")).toBe(due);
  });

  it("rechaza fechas inválidas o pasadas sin crear nada", async () => {
    await seedFunnel();
    const lead = await createLead({ name: "Cliente", channel: "SIMULATOR" });
    expect(await executeTool(lead.id, "create_task", { title: "Llamar", due: "el lunes", notes: "" })).toMatchObject({ isError: true });
    expect(await executeTool(lead.id, "create_task", { title: "Llamar", due: "2020-01-01 10:00", notes: "" })).toMatchObject({ isError: true });
    expect(await executeTool(lead.id, "create_task", { title: "", due: "2099-01-01 10:00", notes: "" })).toMatchObject({ isError: true });
    expect(await db.task.count()).toBe(0);
  });
});
