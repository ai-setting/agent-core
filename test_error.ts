// 这是一个有错误的 TypeScript 脚本

function greet(name: string): string {
    return "Hello, " + name;
}

// 错误1: 缺少分号
const a = 1
const b = 2

// 错误2: 类型错误
const num: number = "hello";

// 错误3: 使用未定义的变量
console.log(unknownVariable);

// 错误4: 语法错误 - 括号不匹配
function broken() {
    if (true) {
        console.log("test"
    }
}
