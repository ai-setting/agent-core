// 这是一个有错误的 TypeScript 脚本

// 错误1: 类型错误 - string 不能赋值给 number
const count: number = "hello";

// 错误2: 使用未定义的变量
console.log(undefinedVar);

// 错误3: 语法错误 - 缺少括号
function greet(name: string {
  return `Hello, ${name}`;
}

// 错误4: 调用不存在的对象方法
const obj = { a: 1 };
obj.b();

// 错误5: 参数类型不匹配
function add(a: number, b: number): number {
  return a + b;
}
add("1", "2");
