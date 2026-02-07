#!/usr/bin/env bun
/**
 * @fileoverview Build Script
 *
 * 构建 tong_work 多平台二进制
 */

import path from "path";
import fs from "fs";
import { $ } from "bun";

const ROOT = path.resolve(".");
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"));

const VERSION = process.env.VERSION || "0.1.0";
const CHANNEL = process.env.CHANNEL || "dev";
const RELEASE = process.env.RELEASE === "1";

const SINGLE_FLAG = process.argv.includes("--single");

const TARGETS = [
  { os: "linux", arch: "arm64", abi: "glibc" },
  { os: "linux", arch: "x64", abi: "glibc" },
  { os: "linux", arch: "x64", abi: "musl" },
  { os: "darwin", arch: "arm64" },
  { os: "darwin", arch: "x64" },
  { os: "win32", arch: "x64" },
];

async function copyRecursive(src: string, dest: string) {
  if (!fs.existsSync(src)) return;
  
  await $`mkdir -p ${dest}`;
  
  for (const item of fs.readdirSync(src)) {
    const srcPath = path.join(src, item);
    const destPath = path.join(dest, item);
    
    if (fs.statSync(srcPath).isDirectory()) {
      await copyRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

async function prepareDependencies() {
  console.log("📦 准备依赖...");
  
  const cliSrc = path.join(ROOT, "packages", "app", "cli", "src");
  const depsDir = path.join(cliSrc, "_deps");
  
  await $`rm -rf ${depsDir}`;
  await $`mkdir -p ${depsDir}`;
  
  const coreDist = path.join(ROOT, "packages", "core", "dist");
  const coreDeps = path.join(depsDir, "agent-core");
  await copyRecursive(coreDist, coreDeps);
  console.log("  ✓ agent-core");
  
  const serverDist = path.join(ROOT, "packages", "app", "server", "dist");
  const serverDeps = path.join(depsDir, "server");
  await copyRecursive(serverDist, serverDeps);
  console.log("  ✓ @agent-core/server");
  
  const serverNodeModules = path.join(ROOT, "packages", "app", "server", "node_modules");
  if (fs.existsSync(serverNodeModules)) {
    const depsNodeModules = path.join(depsDir, "node_modules");
    await copyRecursive(serverNodeModules, depsNodeModules);
    console.log("  ✓ server node_modules");
  }
  
  return depsDir;
}

async function build() {
  console.log(`Building tong_work ${VERSION} (${CHANNEL})`);
  console.log("");

  await $`rm -rf ${path.join(ROOT, "dist")}`;

  const depsDir = await prepareDependencies();
  console.log("");

  const targets = SINGLE_FLAG
    ? TARGETS.filter((t) => t.os === process.platform && t.arch === process.arch)
    : TARGETS;

  for (const target of targets) {
    const targetName = [
      "tong_work",
      target.os === "win32" ? "windows" : target.os,
      target.arch,
      target.abi === "musl" ? "musl" : undefined,
    ]
      .filter(Boolean)
      .join("-");

    console.log(`Building ${targetName}...`);

    const outDir = path.join(ROOT, "dist", targetName, "bin");
    await $`mkdir -p ${outDir}`;

    const outfile =
      target.os === "win32"
        ? path.join(outDir, "tong_work.exe")
        : path.join(outDir, "tong_work");

    try {
      const entrypoint = path.join(ROOT, "packages", "app", "cli", "src", "index.ts");
      
      await $`bun build --compile --outfile=${outfile} ${entrypoint}`;

      if (target.os !== "win32") {
        await $`chmod +x ${outfile}`;
      }

      const pkg = {
        name: targetName,
        version: VERSION,
        os: [target.os],
        cpu: [target.arch],
      };
      await fs.promises.writeFile(
        path.join(ROOT, "dist", targetName, "package.json"),
        JSON.stringify(pkg, null, 2)
      );

      console.log(`  ✓ ${targetName}`);
    } catch (error) {
      console.error(`  ✗ ${targetName}: ${error}`);
    }
  }

  if (RELEASE) {
    console.log("");
    console.log("Creating release archives...");

    for (const target of targets) {
      const targetName = `tong_work-${target.os === "win32" ? "windows" : target.os}-${target.arch}`;
      const distDir = path.join(ROOT, "dist", targetName, "bin");

      if (target.os === "linux") {
        await $`cd ${distDir} && tar -czf ../../${targetName}.tar.gz .`;
      } else {
        await $`cd ${distDir} && zip -r ../../${targetName}.zip .`;
      }
    }

    console.log("Release archives created!");
  }

  console.log("");
  console.log("Build complete!");
}

build().catch(console.error);
