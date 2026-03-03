import type { ISandboxProvider, ISandboxProviderFactory, SandboxType } from "./types.js";
import { NativeSandboxProvider } from "./implementations/native-sandbox.js";

class SandboxProviderFactoryImpl implements ISandboxProviderFactory {
  create(type: SandboxType): ISandboxProvider {
    switch (type) {
      case "native":
        return new NativeSandboxProvider();
      case "docker":
        throw new Error("Docker sandbox is not yet implemented");
      default:
        throw new Error(`Unknown sandbox type: ${type}`);
    }
  }
}

export const SandboxProviderFactory: ISandboxProviderFactory = new SandboxProviderFactoryImpl();
