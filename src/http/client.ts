import { BusinessError } from "../domain/errors";
import type { BusinessErrorShape, FieldError } from "../domain/models";

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type JsonRecord = Record<string, unknown>;

export interface HttpClientOptions {
  baseUrl: string;
  fetchImpl?: FetchLike;
  defaultHeaders?: Record<string, string>;
}

export class HttpClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly defaultHeaders: Record<string, string>;

  constructor(options: HttpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
    this.defaultHeaders = options.defaultHeaders ?? {};
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers: { Accept: "application/json", ...this.defaultHeaders, ...init.headers },
      });
    } catch (cause) {
      throw new BusinessError({
        code: "NETWORK_ERROR",
        message: "无法连接后端，请检查服务地址和网络。",
        fields: [],
        retryable: true,
        diagnostic: cause,
      });
    }

    const payload = await readResponse(response);
    if (!response.ok) throw normalizeHttpError(response.status, payload);
    return payload as T;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: "GET" });
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, {
      method: "POST",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
}

async function readResponse(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export function normalizeHttpError(status: number, payload: unknown): BusinessError {
  const source = isRecord(payload) ? payload : {};
  const sourceCode = stringValue(source.code) ?? `HTTP_${status}`;
  const sourceMessage = stringValue(source.message) ?? "后端未返回可读的错误信息。";
  const fields = normalizeFields(source.field, source.details);
  const code = status === 404 ? "NOT_FOUND" : status === 409 ? "CONFLICT" : status === 400 ? "VALIDATION_ERROR" : status >= 500 ? "SERVER_ERROR" : "REQUEST_FAILED";
  const shape: BusinessErrorShape = {
    code,
    message: sourceMessage,
    fields,
    httpStatus: status,
    retryable: status >= 500 || status === 408 || status === 429,
    sourceCode,
    sourceMessage,
    diagnostic: payload,
  };
  return new BusinessError(shape);
}

function normalizeFields(field: unknown, details: unknown): FieldError[] {
  const result: FieldError[] = [];
  if (typeof field === "string") result.push({ field, message: "该字段不符合后端规则" });
  if (isRecord(details)) {
    for (const [name, value] of Object.entries(details)) {
      result.push({ field: name, message: typeof value === "string" ? value : JSON.stringify(value) });
    }
  }
  return result;
}

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : undefined;
}

export function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
