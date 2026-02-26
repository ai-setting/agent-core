/**
 * 这是一个测试脚本，用于演示TypeScript的warning
 * @deprecated 此函数已废弃，请使用 newFunction 代替
 */

/**
 * @deprecated 请使用 calculateNew 代替
 */
function oldFunction(a: number, b: number): number {
  return a + b;
}

function calculateNew(a: number, b: number): number {
  return a + b;
}

// 未使用的变量 - warning
let unusedVariable = "这是一个未使用的变量";

// 未使用的函数参数 - warning
function unusedParam(name: string, age: number): void {
  console.log(`Hello, ${name}`);
}

// 使用了废弃的函数 - warning
const result = oldFunction(1, 2);

export { oldFunction, calculateNew, unusedVariable, unusedParam, result };
