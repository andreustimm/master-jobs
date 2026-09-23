import { assertRevision, planCommand } from "./domain.ts";
import { validateEvidence } from "./evidence.ts";
import { commandHash, controlBody, deliveryOf, hash, parseCommand, parseControl, parseReceipt, receiptBody, snapshotRevision } from "./protocol.ts";
import { verifyCommandSignature } from "./signing.ts";
import type { Command, ControlState, ProjectConfig, Receipt, RemoteComment, TaskGateway, TaskPatch, TaskSnapshot } from "./types.ts";

export interface CoordinatorOptions { now?: () => Date; validate?: (task: TaskSnapshot, command: Command) => Promise<void> }
export class Coordinator {
  gateway: TaskGateway;
  config: ProjectConfig;
  now: () => Date;
  validate: (task: TaskSnapshot, command: Command) => Promise<void>;
  failures = 0;
  constructor(gateway: TaskGateway, config: ProjectConfig, options: CoordinatorOptions = {}) {
    this.gateway = gateway; this.config = config; this.now = options.now ?? (() => new Date());
    this.validate = options.validate ?? ((task, command) => validateEvidence(gateway, config, task, command));
  }
  async control(): Promise<{ state: ControlState; comment: RemoteComment }> {
    const controls = (await this.gateway.comments(this.config.controlIssue)).filter(c => c.author === this.config.writerLogin).flatMap(comment => { const state = parseControl(comment.body); return state ? [{ state, comment }] : []; });
    if (controls.length !== 1) throw new Error("Exactly one trusted control record is required; run initialize or investigate duplicates");
    return controls[0]!;
  }
  async initialize(activation: NonNullable<ControlState["activation"]>, operationId: string): Promise<void> {
    if (await this.gateway.identity() !== this.config.writerLogin) throw new Error("Writer identity does not match configuration");
    await this.gateway.fields(); // Effective Project permission, not just a secret name.
    const previous = (await this.gateway.comments(this.config.controlIssue)).filter(c => c.author === this.config.writerLogin && parseControl(c.body));
    if (previous.length > 1) throw new Error("Duplicate control records require administrative investigation");
    const state: ControlState = previous[0] ? { ...parseControl(previous[0].body)!, activation } : { protocolVersion: 1, paused: false, manualEpoch: 0, lastOperation: operationId, activation };
    if (previous[0]) await this.gateway.updateComment(previous[0].id, controlBody(state));
    else await this.gateway.comment(this.config.controlIssue, controlBody(state));
    if (hash((await this.control()).state) !== hash(state)) throw new Error("Initialization was not confirmed by read-back");
  }
  async drain(): Promise<Receipt[]> {
    if (await this.gateway.identity() !== this.config.writerLogin) throw new Error("Untrusted writer identity");
    const inbox = await this.gateway.comments(this.config.controlIssue);
    const results: Receipt[] = [];
    this.failures = 0;
    // Terminal receipts never change, so the snapshot read above settles every
    // already-answered command. Re-reading the whole inbox for each of them made
    // one run cost O(commands × pages) and outgrew the token's rate limit.
    const settled = new Map<string, Receipt[]>();
    for (const comment of inbox) {
      if (comment.author !== this.config.writerLogin) continue;
      const receipt = parseReceipt(comment.body);
      if (receipt) settled.set(receipt.operationId, [...(settled.get(receipt.operationId) ?? []), receipt]);
    }
    for (const request of inbox.sort((a,b) => a.id-b.id)) {
      let command: Command | null;
      try { command = parseCommand(request.body); } catch { continue; } // Malformed data never executes.
      if (!command) continue;
      const known = settled.get(command.operationId);
      const done = known?.length === 1 && known[0]!.commandHash === commandHash(command) && known[0]!.actor === request.author && ["confirmed", "rejected"].includes(known[0]!.phase) ? known[0] : undefined;
      if (done) { results.push(done); continue; }
      try { results.push(await this.process(command, request)); }
      catch (error) {
        this.failures++;
        const marker = `<!-- tasks-conflict:${request.id}:${commandHash(command)} -->`;
        if (!inbox.some(c => c.author === this.config.writerLogin && c.body.startsWith(marker))) {
          const message = error instanceof Error ? error.message : "Operation could not be reconciled";
          await this.gateway.comment(this.config.controlIssue, `${marker}\nPedido ${request.id}, operação ${command.operationId}: ${message}\n\nO conflito não autoriza a execução e não impede processar outras intenções. Reconciliação administrativa pode ser necessária.`);
        }
      }
    }
    return results;
  }
  async process(command: Command, request: RemoteComment): Promise<Receipt> {
    const digest = commandHash(command);
    const inbox = await this.gateway.comments(this.config.controlIssue);
    const receipts = inbox.filter(c => c.author === this.config.writerLogin).flatMap(comment => { const value = parseReceipt(comment.body); return value ? [{ comment, value }] : []; });
    const existing = receipts.filter(r => r.value.operationId === command.operationId);
    if (existing.length > 1) throw new Error(`Duplicate trusted receipts for ${command.operationId}`);
    if (existing[0]) {
      const entry = existing[0];
      if (entry.value.commandHash !== digest || entry.value.actor !== request.author) throw new Error("OPERATION_CONFLICT: operationId already has a different payload/actor");
      if (entry.value.phase === "confirmed" || entry.value.phase === "rejected") return entry.value;
      return this.recover(entry.comment, entry.value);
    }
    const receipt: Receipt = { protocolVersion: 1, operationId: command.operationId, commandHash: digest, requestId: request.id, issue: command.issue, phase: "prepared", actor: request.author, message: command.action, at: this.now().toISOString() };
    let durable: RemoteComment | undefined;
    let preparationAttempted = false;
    try {
      if (request.createdAt !== request.updatedAt) throw new Error("Edited commands are rejected; submit a new operation");
      const permission = await this.gateway.permission(request.author);
      if (!["admin", "maintain", "write"].includes(permission)) throw new Error("Actor does not have repository write permission");
      const admin = permission === "admin";
      const { state, comment } = await this.control();
      if (["adopt", "pause", "unpause", "reconcile"].includes(command.action) && !admin) throw new Error("This operation requires the repository administrator");
      if (command.action === "pause" || command.action === "unpause") {
        if (command.issue !== this.config.controlIssue || !command.reason) throw new Error("Global pause/unpause needs control issue and reason");
        if (receipts.some(r => r.value.phase === "prepared" || r.value.phase === "uncertain")) throw new Error("Unresolved operations prevent pause acknowledgement; reconcile them first");
        receipt.controlBefore = state;
        receipt.controlAfter = { ...state, paused: command.action === "pause", manualEpoch: state.manualEpoch + (command.action === "unpause" ? 1 : 0), lastOperation: command.operationId };
        preparationAttempted = true;
        durable = await this.recordReceipt(receipt);
        await this.gateway.updateComment(comment.id, controlBody(receipt.controlAfter));
        if ((await this.control()).state.lastOperation !== command.operationId) throw new Error("Control write not confirmed");
        return this.finish(durable, receipt, "confirmed", `${command.action} acknowledged; writer drained`);
      }
      if (state.paused) throw new Error("WRITER_PAUSED: no task writes are authorized");
      if (receipts.some(r => r.value.issue === command.issue && ["prepared", "uncertain"].includes(r.value.phase)) && command.action !== "reconcile") throw new Error("UNRESOLVED_OPERATION: reconcile the previous mutation first");
      if (command.action === "create") {
        if (!command.create) throw new Error("Create payload is required");
        preparationAttempted = true;
        durable = await this.recordReceipt(receipt);
        return await this.create(command, request.author, durable, receipt, state.manualEpoch);
      }
      const before = await this.gateway.readTask(command.issue, state.manualEpoch);
      assertRevision(before, command);
      let patch: TaskPatch;
      if (command.action === "adopt") {
        if (!command.adopt) throw new Error("Adoption contract is required");
        const existingDelivery = before.issue.body.match(/<!-- task-delivery:(dev|production|artifact|operation) -->/g) ?? [];
        if (existingDelivery.length > 1 || (existingDelivery[0] && deliveryOf(before.issue.body) !== command.adopt.delivery)) throw new Error("Existing delivery contract differs; edit the issue deliberately first");
        patch = { fields: { ...(!before.status ? { status: "Backlog" as const } : {}), ...(!before.priority ? { priority: command.adopt.priority } : {}), ...(!before.type ? { type: command.adopt.type } : {}) }, ...(!existingDelivery.length ? { body: `${before.issue.body}\n\n<!-- task-delivery:${command.adopt.delivery} -->` } : {}) };
      } else if (command.action === "reconcile") {
        if (!command.reason || !command.evidence?.length) throw new Error("Reconciliation requires reason and evidence of the observed remote state and preserved WIP");
        const owner = before.coordination?.execution;
        const preserveOwner = !!owner && Date.parse(owner.expiresAt) > this.now().getTime();
        const journal = receipts.filter(r => r.value.issue === command.issue && r.value.phase !== "rejected");
        const revision = Math.max(before.coordination?.revision ?? 0, ...journal.map(r => r.value.patch?.coordination?.revision ?? 0)) + 1;
        const generation = preserveOwner ? before.coordination!.generation : Math.max(before.coordination?.generation ?? 0, ...journal.map(r => r.value.patch?.coordination?.generation ?? 0)) + 1;
        patch = { fields: {}, coordination: { protocolVersion: 1, revision, generation, execution: preserveOwner ? owner : null, lastOperation: command.operationId, ...(before.coordination?.previousStatus ? { previousStatus: before.coordination.previousStatus } : {}), ...(before.coordination?.firstClaimedAt ? { firstClaimedAt: before.coordination.firstClaimedAt } : {}) } };
      } else {
        verifyCommandSignature(command, command.action === "claim" ? undefined : before.coordination?.execution?.publicKey);
        patch = planCommand(before, command, request.author, this.now());
        await this.validate(before, command);
      }
      receipt.before = before; receipt.patch = patch;
      preparationAttempted = true;
      durable = await this.recordReceipt(receipt);
      const fresh = await this.gateway.readTask(command.issue, state.manualEpoch);
      if (fresh.revision !== before.revision) throw new Error("STALE_REVISION after preparation; no task write applied");
      if (!fresh.itemId && command.action === "adopt") {
        await this.gateway.addToProject(fresh.issue.id);
        const added = await this.gateway.readTask(command.issue, state.manualEpoch);
        await this.gateway.patchTask(added, patch);
      } else await this.gateway.patchTask(fresh, patch);
      const after = await this.gateway.readTask(command.issue, state.manualEpoch);
      this.assertApplied(after, patch);
      if (command.action === "reconcile") {
        for (const pending of receipts.filter(r => r.value.issue === command.issue && ["prepared", "uncertain"].includes(r.value.phase))) await this.finish(pending.comment, pending.value, "rejected", `Superseded by explicit administrative reconciliation ${command.operationId}; original result was not confirmed`);
      }
      receipt.result = { issue: after.issue.number, revision: after.revision, execution: after.coordination?.execution };
      return await this.finish(durable, receipt, "confirmed", `${command.action} confirmed by remote read-back`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Coordinator operation failed";
      if (durable) return this.finish(durable, receipt, "uncertain", message);
      // A failed POST may already have persisted the prepared receipt. Never
      // publish a second, contradictory rejected receipt after an ambiguous send.
      if (preparationAttempted) return { ...receipt, phase: "uncertain", message: `Receipt creation unconfirmed; no task mutation was attempted: ${message}` };
      receipt.phase = "rejected"; receipt.message = message;
      await this.recordReceipt(receipt);
      return receipt;
    }
  }
  async recordReceipt(receipt: Receipt): Promise<RemoteComment> {
    const body = receiptBody(receipt);
    if (body.length > 60_000) throw new Error("Receipt exceeds the safe comment size; reduce task body before retry");
    try { return await this.gateway.comment(this.config.controlIssue, body); }
    catch (error) {
      const matches = (await this.gateway.comments(this.config.controlIssue)).filter(c => c.author === this.config.writerLogin && hash(parseReceipt(c.body)) === hash(receipt));
      if (matches.length === 1) return matches[0]!;
      throw error;
    }
  }
  async create(command: Command, actor: string, durable: RemoteComment, receipt: Receipt, epoch: number): Promise<Receipt> {
    const data = command.create!;
    let issue = await this.gateway.findCreatedIssue(command.operationId);
    if (!issue) issue = await this.gateway.createIssue(data.title, `${data.body}\n\n<!-- task-delivery:${data.delivery} -->\n<!-- task-created:${command.operationId} -->`, actor);
    if (!issue.assignees.includes(actor)) throw new Error("Created issue lost its expected assignee; reconcile explicitly");
    let snapshot = await this.gateway.readTask(issue.number, epoch);
    if (!snapshot.itemId) { await this.gateway.addToProject(issue.id); snapshot = await this.gateway.readTask(issue.number, epoch); }
    if (data.parent) await this.gateway.addSubIssue(data.parent, issue.id);
    for (const dep of data.dependsOn) await this.gateway.addDependency(issue.number, dep);
    const patch: TaskPatch = { fields: { ...(!snapshot.status ? { status: "Backlog" as const } : {}), ...(!snapshot.priority ? { priority: data.priority } : {}), ...(!snapshot.type ? { type: data.type } : {}) } };
    await this.gateway.patchTask(snapshot, patch);
    const after = await this.gateway.readTask(issue.number, epoch);
    this.assertApplied(after, patch);
    if (!after.itemId || (data.parent && after.parent !== data.parent) || data.dependsOn.some(dep => !after.dependencies.some(d => d.number === dep))) throw new Error("Created issue relationships not confirmed");
    receipt.issue = issue.number; receipt.result = { issue: issue.number, revision: after.revision };
    return this.finish(durable, receipt, "confirmed", "Issue, Project membership and native relationships confirmed");
  }
  async recover(comment: RemoteComment, receipt: Receipt): Promise<Receipt> {
    const { state, comment: controlComment } = await this.control();
    if (state.lastOperation === receipt.operationId) return this.finish(comment, receipt, "confirmed", "Recovered control acknowledgement");
    const requests = await this.gateway.comments(this.config.controlIssue);
    const request = requests.find(c => c.id === receipt.requestId);
    const command = request && parseCommand(request.body);
    if (!command || commandHash(command) !== receipt.commandHash || request.author !== receipt.actor || request.createdAt !== request.updatedAt) throw new Error("Prepared request was altered or removed; administrator must reconcile");
    const permission = await this.gateway.permission(receipt.actor);
    if (!["admin", "maintain", "write"].includes(permission) || (["adopt", "reconcile", "pause", "unpause"].includes(command.action) && permission !== "admin")) return this.finish(comment, receipt, "uncertain", "Actor permission changed; administrative reconciliation required");
    if (command.action === "pause" || command.action === "unpause") {
      if (!receipt.controlBefore || !receipt.controlAfter) return this.finish(comment, receipt, "uncertain", "Missing prepared control state; administrator must inspect the journal");
      if (hash(state) !== hash(receipt.controlBefore)) return this.finish(comment, receipt, "rejected", "Control was superseded; no stale pause or epoch was applied");
      const pending = requests.filter(c => c.author === this.config.writerLogin).map(c => parseReceipt(c.body)).some(r => r && r.operationId !== receipt.operationId && ["prepared", "uncertain"].includes(r.phase));
      if (pending) return receipt;
      await this.gateway.updateComment(controlComment.id, controlBody(receipt.controlAfter));
      if (hash((await this.control()).state) !== hash(receipt.controlAfter)) throw new Error("Recovered control write was not confirmed");
      return this.finish(comment, receipt, "confirmed", "Prepared control operation resumed and confirmed");
    }
    if (state.paused) return receipt;
    if (command.action === "create") return this.create(command, receipt.actor, comment, receipt, state.manualEpoch);
    if (!receipt.before || !receipt.patch) return receipt;
    const current = await this.gateway.readTask(receipt.issue, state.manualEpoch);
    if (command.action === "adopt") {
      try { this.assertApplied(current, receipt.patch); receipt.result = { issue: current.issue.number, revision: current.revision }; return await this.finish(comment, receipt, "confirmed", "Adoption recovered by read-back"); }
      catch { /* An incomplete adoption still needs an explicit reconciliation. */ }
    }
    if (current.coordination?.lastOperation === receipt.operationId) {
      try { this.assertApplied(current, receipt.patch); receipt.result = { issue: current.issue.number, revision: current.revision, execution: current.coordination?.execution }; return await this.finish(comment, receipt, "confirmed", "Recovered mutation confirmed by read-back"); }
      catch { return this.finish(comment, receipt, "uncertain", "Partial mutation requires administrative reconciliation"); }
    }
    // Retrying only when all semantic state is still the pre-mutation state cannot
    // reassign a task after another execution or a manual epoch has superseded it.
    if (snapshotRevision(current) === receipt.before.revision) {
      if (!["adopt", "reconcile"].includes(command.action)) {
        try {
          verifyCommandSignature(command, command.action === "claim" ? undefined : current.coordination?.execution?.publicKey);
          planCommand(current, command, receipt.actor, this.now());
          await this.validate(current, command);
        } catch (error) {
          return this.finish(comment, receipt, "uncertain", `Recovery guard rejected the unapplied mutation: ${error instanceof Error ? error.message : "current evidence unavailable"}`);
        }
      }
      if (receipt.patch.coordination?.execution && Date.parse(receipt.patch.coordination.execution.expiresAt) <= this.now().getTime()) return this.finish(comment, receipt, "uncertain", "Prepared lease expired before application; no stale owner was granted");
      await this.gateway.patchTask(current, receipt.patch);
      const after = await this.gateway.readTask(receipt.issue, state.manualEpoch);
      this.assertApplied(after, receipt.patch);
      receipt.result = { issue: after.issue.number, revision: after.revision, execution: after.coordination?.execution };
      return this.finish(comment, receipt, "confirmed", "Prepared mutation resumed and confirmed");
    }
    return this.finish(comment, receipt, "uncertain", "Remote state diverged; no retry applied");
  }
  assertApplied(after: TaskSnapshot, patch: TaskPatch): void {
    for (const [key, value] of Object.entries(patch.fields)) if (after[key as keyof TaskSnapshot] !== value) throw new Error(`Read-back mismatch: ${key}`);
    if (patch.body !== undefined && after.issue.body !== patch.body) throw new Error("Read-back mismatch: issue body");
    if (patch.coordination && hash(after.coordination) !== hash(patch.coordination)) throw new Error("Read-back mismatch: coordination");
    if (patch.close && (after.issue.state !== "CLOSED" || after.issue.stateReason?.toLowerCase() !== patch.close)) throw new Error("Read-back mismatch: issue closure");
  }
  async finish(comment: RemoteComment, receipt: Receipt, phase: Receipt["phase"], message: string): Promise<Receipt> {
    const result = { ...receipt, phase, message, at: this.now().toISOString() };
    await this.gateway.updateComment(comment.id, receiptBody(result));
    const check = (await this.gateway.comments(this.config.controlIssue)).find(c => c.id === comment.id);
    if (!check || check.author !== this.config.writerLogin || hash(parseReceipt(check.body)) !== hash(result)) throw new Error("Receipt write not confirmed; operation remains pending");
    return result;
  }
}
