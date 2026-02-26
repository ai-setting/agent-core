/**
 * 这是一个测试脚本
 * 用于测试 write_file 工具的输出效果
 */

// @ts-ignore - 故意忽略类型检查
const ignoreWarning: string = 123;

// TODO: 需要完成这个函数的实现
function processData(data: string): string {
  // FIXME: 这里有潜在的 bug，需要修复
  console.warn('Warning: Processing data...');
  return data.toUpperCase();
}

// 模拟一个 deprecated 函数
/**
 * @deprecated 请使用 processData 代替
 */
function oldProcessData(data: string): string {
  console.warn('Warning: Using deprecated function!');
  return data.toLowerCase();
}

export { processData, oldProcessData };
