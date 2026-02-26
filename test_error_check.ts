// 这是一个有错误的 TypeScript 脚本

function add(a: number, b: number): number {
  return a + b;
}

// 错误1: 类型不匹配 - 期望 number 但传入 string
const result: string = add(1, 2);

// 错误2: 使用未定义的变量
console.log(undefinedVariable);

// 错误3: 缺少必要参数
add(1);

export {};
