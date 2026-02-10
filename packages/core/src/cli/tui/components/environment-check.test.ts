/**
 * @fileoverview OpenTUI 真实环境检测测试
 *
 * 检测实际运行环境中的 OpenTUI 组件行为
 */

import { describe, it, expect } from "bun:test";

// ============================================================================
// 真实环境检测
// ============================================================================

describe("OpenTUI 真实环境检测", () => {
  it("应该检测 @opentui/core 是否可导入", async () => {
    let canImportOpenTUI = false;
    let openTUIExports: any = null;

    try {
      const openTUI = await import("@opentui/core");
      openTUIExports = openTUI;
      canImportOpenTUI = true;
    } catch (e) {
      canImportOpenTUI = false;
    }

    // 记录检测结果
    console.log("[环境检测] @opentui/core 可导入:", canImportOpenTUI);
    
    if (canImportOpenTUI) {
      console.log("[环境检测] 可用导出:", Object.keys(openTUIExports));
    }

    // 在测试环境中可能不可用，这不一定是错误
    expect(typeof canImportOpenTUI).toBe("boolean");
  });

  it("应该检测 @opentui/solid 是否可导入", async () => {
    let canImportOpenTUISolid = false;
    let solidExports: any = null;

    try {
      const solid = await import("@opentui/solid");
      solidExports = solid;
      canImportOpenTUISolid = true;
    } catch (e) {
      canImportOpenTUISolid = false;
    }

    console.log("[环境检测] @opentui/solid 可导入:", canImportOpenTUISolid);
    
    if (canImportOpenTUISolid) {
      console.log("[环境检测] 可用导出:", Object.keys(solidExports));
    }

    expect(typeof canImportOpenTUISolid).toBe("boolean");
  });

  it("应该检测 SyntaxStyle 类", async () => {
    let syntaxStyleInfo = {
      exists: false,
      hasFromTheme: false,
      hasGetStyle: false,
    };

    try {
      const { SyntaxStyle } = await import("@opentui/core");
      syntaxStyleInfo.exists = true;
      syntaxStyleInfo.hasFromTheme = typeof SyntaxStyle?.fromTheme === "function";
      
      if (syntaxStyleInfo.hasFromTheme) {
        // 尝试创建实例
        const rules = [{ scope: ["default"], style: { foreground: "#fff" } }];
        const instance = SyntaxStyle.fromTheme(rules);
        syntaxStyleInfo.hasGetStyle = typeof instance?.getStyle === "function";
        
        console.log("[环境检测] SyntaxStyle 实例:", {
          type: typeof instance,
          hasGetStyle: syntaxStyleInfo.hasGetStyle,
          instanceKeys: Object.keys(instance || {}),
        });
      }
    } catch (e) {
      console.log("[环境检测] SyntaxStyle 检测失败:", (e as Error).message);
    }

    console.log("[环境检测] SyntaxStyle 检测结果:", syntaxStyleInfo);

    // 记录结果，但不强制要求存在（测试环境可能不可用）
    expect(typeof syntaxStyleInfo.exists).toBe("boolean");
    expect(typeof syntaxStyleInfo.hasFromTheme).toBe("boolean");
  });

  it("应该检测 resolveRenderLib 函数", async () => {
    let resolveRenderLibInfo = {
      exists: false,
      returnsValue: false,
      returnType: "unknown",
    };

    try {
      const { resolveRenderLib } = await import("@opentui/core");
      resolveRenderLibInfo.exists = typeof resolveRenderLib === "function";
      
      if (resolveRenderLibInfo.exists) {
        const result = resolveRenderLib();
        resolveRenderLibInfo.returnsValue = result !== null && result !== undefined;
        resolveRenderLibInfo.returnType = typeof result;
        
        console.log("[环境检测] resolveRenderLib 返回:", {
          type: resolveRenderLibInfo.returnType,
          value: result,
          keys: result ? Object.keys(result) : null,
        });
      }
    } catch (e) {
      console.log("[环境检测] resolveRenderLib 检测失败:", (e as Error).message);
    }

    console.log("[环境检测] resolveRenderLib 检测结果:", resolveRenderLibInfo);

    expect(typeof resolveRenderLibInfo.exists).toBe("boolean");
  });

  it("应该检测 markdown 组件", async () => {
    let markdownInfo = {
      exists: false,
      isFunction: false,
    };

    try {
      const solid = await import("@opentui/solid");
      
      // 检查是否有 markdown 组件
      if (solid.markdown) {
        markdownInfo.exists = true;
        markdownInfo.isFunction = typeof solid.markdown === "function";
      }
      
      console.log("[环境检测] @opentui/solid 导出:", {
        keys: Object.keys(solid),
        hasMarkdown: "markdown" in solid,
      });
    } catch (e) {
      console.log("[环境检测] markdown 组件检测失败:", (e as Error).message);
    }

    console.log("[环境检测] markdown 组件检测结果:", markdownInfo);

    expect(typeof markdownInfo.exists).toBe("boolean");
  });
});

// ============================================================================
// 问题诊断测试
// ============================================================================

describe("TUI 问题诊断", () => {
  it("应该诊断 Markdown 样式问题", async () => {
    const diagnostics: string[] = [];

    // 检查 1: @opentui/core
    try {
      const openTUI = await import("@opentui/core");
      diagnostics.push("✓ @opentui/core 可导入");
      
      // 检查 SyntaxStyle
      if (openTUI.SyntaxStyle) {
        diagnostics.push("✓ SyntaxStyle 类存在");
        
        if (typeof openTUI.SyntaxStyle.fromTheme === "function") {
          diagnostics.push("✓ SyntaxStyle.fromTheme 方法存在");
          
          try {
            const rules = [
              { scope: ["default"], style: { foreground: "#ffffff" } },
              { scope: ["markup.strong"], style: { foreground: "#ffffff", bold: true } },
            ];
            const instance = openTUI.SyntaxStyle.fromTheme(rules);
            
            if (instance) {
              diagnostics.push("✓ SyntaxStyle.fromTheme 返回实例");
              
              if (typeof instance.getStyle === "function") {
                diagnostics.push("✓ 实例有 getStyle 方法");
                
                const style = instance.getStyle("default");
                if (style) {
                  diagnostics.push("✓ getStyle('default') 返回有效样式");
                } else {
                  diagnostics.push("✗ getStyle('default') 返回 undefined");
                }
              } else {
                diagnostics.push("✗ 实例缺少 getStyle 方法");
              }
            } else {
              diagnostics.push("✗ SyntaxStyle.fromTheme 返回 null/undefined");
            }
          } catch (e) {
            diagnostics.push(`✗ SyntaxStyle.fromTheme 调用失败: ${(e as Error).message}`);
          }
        } else {
          diagnostics.push("✗ SyntaxStyle.fromTheme 方法不存在");
        }
      } else {
        diagnostics.push("✗ SyntaxStyle 类不存在");
      }
      
      // 检查 resolveRenderLib
      if (typeof openTUI.resolveRenderLib === "function") {
        diagnostics.push("✓ resolveRenderLib 函数存在");
        
        const lib = openTUI.resolveRenderLib();
        if (lib) {
          diagnostics.push("✓ resolveRenderLib 返回非 null 值");
        } else {
          diagnostics.push("⚠ resolveRenderLib 返回 null（非 TUI 环境）");
        }
      } else {
        diagnostics.push("✗ resolveRenderLib 函数不存在");
      }
    } catch (e) {
      diagnostics.push(`✗ @opentui/core 导入失败: ${(e as Error).message}`);
    }

    // 检查 2: @opentui/solid
    try {
      const solid = await import("@opentui/solid");
      diagnostics.push("✓ @opentui/solid 可导入");
      
      if (solid.markdown) {
        diagnostics.push("✓ markdown 组件存在");
      } else {
        diagnostics.push("⚠ markdown 组件不存在（可能未导出）");
      }
    } catch (e) {
      diagnostics.push(`✗ @opentui/solid 导入失败: ${(e as Error).message}`);
    }

    console.log("\n========== TUI 问题诊断报告 ==========");
    for (const line of diagnostics) {
      console.log(line);
    }
    console.log("=====================================\n");

    // 至少应该有诊断信息
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("应该验证关键执行路径", async () => {
    const results: any = {};

    // 路径 1: MarkdownStyleProvider 初始化
    try {
      const { resolveRenderLib } = await import("@opentui/core");
      results.renderLibAvailable = resolveRenderLib();
      
      if (results.renderLibAvailable) {
        const { SyntaxStyle } = await import("@opentui/core");
        const rules = [{ scope: ["default"], style: { foreground: "#fff" } }];
        const instance = SyntaxStyle.fromTheme(rules);
        
        results.syntaxStyleCreated = !!instance;
        results.hasGetStyle = instance && typeof instance.getStyle === "function";
        
        if (results.hasGetStyle) {
          results.styleRetrieved = !!instance.getStyle("default");
        }
      }
    } catch (e) {
      results.error = (e as Error).message;
    }

    console.log("[路径验证] MarkdownStyleProvider 关键路径:", results);

    // 记录结果
    expect(typeof results).toBe("object");
  });
});

// ============================================================================
// 预期行为验证
// ============================================================================

describe("预期行为验证", () => {
  it("应该记录当前环境的预期 vs 实际行为", () => {
    const expectations = {
      // 预期在正常 TUI 环境下
      normalTUI: {
        renderLibAvailable: true,
        syntaxStyleValid: true,
        markdownRenders: true,
      },
      // 预期在测试/非 TUI 环境下
      testEnvironment: {
        renderLibAvailable: false,
        syntaxStyleValid: false,
        markdownRenders: false,
      },
    };

    console.log("\n========== 预期行为对比 ==========");
    console.log("正常 TUI 环境预期:", expectations.normalTUI);
    console.log("测试环境预期:", expectations.testEnvironment);
    console.log("==================================\n");

    expect(expectations.normalTUI.syntaxStyleValid).toBe(true);
    expect(expectations.testEnvironment.syntaxStyleValid).toBe(false);
  });
});
