import esbuild from "esbuild";

const production = process.argv[2] === "production";

esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian"],
  format: "cjs",
  target: "es2020",
  outfile: "main.js",
  sourcemap: production ? false : "inline",
  minify: production,
}).catch(() => process.exit(1));
