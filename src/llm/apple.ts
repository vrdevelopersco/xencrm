// Cliente del sidecar Swift (sidecar/main.swift) que expone Apple Foundation Models por stdio.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { env } from '../config.js';

export class AppleError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface SchemaSpec {
  properties: { name: string; type?: 'string' | 'number' | 'integer' | 'boolean'; enum?: string[]; description?: string }[];
}

export interface AppleChatInput {
  session: string;
  instructions: string;
  prompt: string;
  /** Historial condensado; solo se usa cuando el sidecar crea una sesión nueva */
  history?: string;
  temperature?: number;
  maxTokens?: number;
  /** Fuerza sesión nueva (p. ej. el turno anterior lo respondió otro motor) */
  fresh?: boolean;
  /** Reinicia la sesión cada N turnos (útil para el gate compartido) */
  maxTurns?: number;
  schema?: SchemaSpec;
}

type Waiter = { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };

class Sidecar {
  private proc?: ChildProcessWithoutNullStreams;
  private pending = new Map<number, Waiter>();
  private nextId = 1;
  private buf = '';
  info?: { contextSize: number; languages: string[] };

  get binPath() {
    return resolve(env.appleSidecarBin);
  }
  get installed() {
    return process.platform === 'darwin' && existsSync(this.binPath);
  }

  private ensure(): ChildProcessWithoutNullStreams {
    if (this.proc && this.proc.exitCode === null && !this.proc.killed) return this.proc;
    if (!this.installed) throw new AppleError('not_installed', `No existe ${this.binPath}. Ejecuta: pnpm build:sidecar`);
    const p = spawn(this.binPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', (chunk: string) => this.onData(chunk));
    p.stderr.setEncoding('utf8');
    p.stderr.on('data', (d: string) => console.error('[apple]', d.trim()));
    p.on('exit', (code, signal) => {
      if (this.proc === p) this.proc = undefined;
      for (const w of this.pending.values()) {
        clearTimeout(w.timer);
        w.reject(new AppleError('crashed', `el sidecar terminó (${code ?? signal})`));
      }
      this.pending.clear();
    });
    this.proc = p;
    return p;
  }

  private onData(chunk: string) {
    this.buf += chunk;
    let nl: number;
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (!line) continue;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      const w = this.pending.get(msg.id as number);
      if (!w) continue;
      this.pending.delete(msg.id as number);
      clearTimeout(w.timer);
      if (msg.ok) w.resolve(msg);
      else w.reject(new AppleError(String(msg.error ?? 'other'), String(msg.message ?? 'error del sidecar')));
    }
  }

  request(op: string, payload: Record<string, unknown>, timeoutMs = 60_000): Promise<Record<string, unknown>> {
    const p = this.ensure();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new AppleError('timeout', `el sidecar no respondió en ${timeoutMs}ms`));
        p.kill('SIGKILL'); // se relanza en la siguiente petición
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      p.stdin.write(JSON.stringify({ id, op, ...payload }) + '\n');
    });
  }

  /** Comprueba binario + disponibilidad del modelo (Apple Intelligence activo, modelo descargado). */
  async probe(): Promise<{ ok: boolean; reason?: string }> {
    if (!this.installed) return { ok: false, reason: `falta ${env.appleSidecarBin} (pnpm build:sidecar)` };
    try {
      const h = await this.request('health', {}, 20_000);
      if (!h.available) return { ok: false, reason: String(h.availability) };
      this.info = { contextSize: Number(h.context_size), languages: (h.languages as string[]) ?? [] };
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
    }
  }

  async chat(input: AppleChatInput): Promise<{ content: string; newSession: boolean; ms: number }> {
    const r = await this.request('chat', {
      session: input.session,
      instructions: input.instructions,
      prompt: input.prompt,
      history: input.history,
      temperature: input.temperature,
      max_tokens: input.maxTokens,
      fresh: input.fresh,
      max_turns: input.maxTurns,
      schema: input.schema,
    });
    return { content: String(r.content ?? ''), newSession: Boolean(r.new_session), ms: Number(r.ms ?? 0) };
  }

  async count(text: string): Promise<number> {
    return Number((await this.request('count', { text }, 20_000)).tokens);
  }

  async reset(session?: string) {
    await this.request('reset', session ? { session } : {}, 10_000).catch(() => undefined);
  }

  stop() {
    this.proc?.kill();
  }
}

export const apple = new Sidecar();
