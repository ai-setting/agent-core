/**
 * @fileoverview API Client - TUI 统一请求封装
 * 
 * 自动为每个请求生成并注入 X-Request-Id Header
 */

import { getTraceContext } from "../../../utils/trace-context.js";

export interface ApiClientOptions {
  baseUrl: string;
  password?: string;
}

export interface ApiClient {
  apiCall: (endpoint: string, options?: RequestInit) => Promise<Response>;
  getBaseUrl: () => string;
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const { baseUrl, password } = options;
  const trace = getTraceContext();

  const apiCall = async (endpoint: string, init?: RequestInit): Promise<Response> => {
    const requestId = trace.generateRequestId();
    
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (password) {
      headers["Authorization"] = `Bearer ${password}`;
    }

    headers["X-Request-Id"] = requestId;

    return fetch(`${baseUrl}${endpoint}`, {
      ...init,
      headers: {
        ...headers,
        ...(init?.headers as Record<string, string> || {}),
      },
    });
  };

  return {
    apiCall,
    getBaseUrl: () => baseUrl,
  };
}
