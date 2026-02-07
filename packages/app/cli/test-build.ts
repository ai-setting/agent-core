import path from "path";

const ROOT = path.resolve(".");
const outfile = path.join(ROOT, "dist", "test2.exe");

console.log("ROOT:", ROOT);
console.log("outfile:", outfile);

await Bun.build({
  entrypoints: [path.join(ROOT, "src", "index.ts")],
  outfile,
  target: "bun",
  compile: {
    executable: true,
  },
});
