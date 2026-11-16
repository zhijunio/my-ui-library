#!/usr/bin/env node

import fs from "node:fs/promises"
import path from "node:path"
import process from "node:process"
import ts from "typescript"

const root = process.cwd()
const sourceRoot = path.join(root, "src")
const uiRoot = path.join(sourceRoot, "components", "ui")
const packageJson = JSON.parse(
  await fs.readFile(path.join(root, "package.json"), "utf8")
)

function parseOptions(args) {
  const options = {}

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]

    if (arg === "--github" || arg === "--homepage") {
      const value = args[index + 1]
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for ${arg}`)
      }
      options[arg.slice(2)] = value
      index += 1
      continue
    }

    throw new Error(`Unknown option: ${arg}`)
  }

  return options
}

function toPosix(value) {
  return value.split(path.sep).join("/")
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

function getItemName(filePath) {
  return path.basename(filePath, path.extname(filePath))
}

function getTitle(name) {
  return name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function getRegistryFile(filePath) {
  const relativeToSrc = toPosix(path.relative(sourceRoot, filePath))
  const segments = relativeToSrc.split("/")

  if (relativeToSrc.startsWith("components/ui/")) {
    return {
      path: toPosix(path.relative(root, filePath)),
      type: "registry:ui",
      target: `@ui/${segments.slice(2).join("/")}`,
    }
  }

  if (relativeToSrc.startsWith("components/")) {
    return {
      path: toPosix(path.relative(root, filePath)),
      type: "registry:component",
      target: `@components/${segments.slice(1).join("/")}`,
    }
  }

  if (relativeToSrc.startsWith("hooks/")) {
    return {
      path: toPosix(path.relative(root, filePath)),
      type: "registry:hook",
      target: `@hooks/${segments.slice(1).join("/")}`,
    }
  }

  if (relativeToSrc.startsWith("lib/")) {
    return {
      path: toPosix(path.relative(root, filePath)),
      type: "registry:lib",
      target: `@lib/${segments.slice(1).join("/")}`,
    }
  }

  return {
    path: toPosix(path.relative(root, filePath)),
    type: "registry:file",
    target: `~/src/${relativeToSrc}`,
  }
}

function collectModuleSpecifiers(filePath) {
  const source = ts.createSourceFile(
    filePath,
    ts.sys.readFile(filePath) ?? "",
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
  const specifiers = new Set()

  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.add(node.moduleSpecifier.text)
    }

    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.add(node.arguments[0].text)
    }

    ts.forEachChild(node, visit)
  }

  visit(source)
  return [...specifiers]
}

function getPackageName(specifier) {
  if (specifier.startsWith("node:")) return null
  if (specifier.startsWith("@/")) return null

  const parts = specifier.split("/")
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]
}

function addPackageDependency(specifier, dependencies, devDependencies) {
  const packageName = getPackageName(specifier)
  if (!packageName || ["react", "react-dom", "next"].includes(packageName)) {
    return
  }

  const version = packageJson.dependencies?.[packageName]
  if (version) {
    dependencies.add(`${packageName}@${version}`)
    return
  }

  const devVersion = packageJson.devDependencies?.[packageName]
  if (devVersion) {
    devDependencies.add(`${packageName}@${devVersion}`)
    return
  }

  dependencies.add(packageName)
}

const options = parseOptions(process.argv.slice(2))
let githubRepository = null

if (options.github) {
  const parts = options.github.split("/").filter(Boolean)
  if (parts.length !== 2) {
    throw new Error("--github must use the owner/repository format")
  }
  githubRepository = parts.join("/")
}

const configPath = path.join(root, "tsconfig.json")
const configFile = ts.readConfigFile(configPath, ts.sys.readFile)
if (configFile.error) {
  throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n"))
}
const parsedConfig = ts.parseJsonConfigFileContent(
  configFile.config,
  ts.sys,
  root
)

const componentPaths = (await fs.readdir(uiRoot))
  .filter((fileName) => fileName.endsWith(".tsx"))
  .map((fileName) => path.join(uiRoot, fileName))
  .sort()

if (componentPaths.length === 0) {
  throw new Error(`No .tsx components found in ${path.relative(root, uiRoot)}`)
}

const componentNames = new Map(
  componentPaths.map((filePath) => [path.resolve(filePath), getItemName(filePath)])
)
const packageItems = []

for (const componentPath of componentPaths) {
  const name = getItemName(componentPath)
  const localFiles = new Map()
  const componentDependencies = new Set()
  const dependencies = new Set()
  const devDependencies = new Set()
  const visited = new Set()

  function resolveImport(specifier, containingFile) {
    const result = ts.resolveModuleName(
      specifier,
      containingFile,
      parsedConfig.options,
      ts.sys
    ).resolvedModule

    if (result?.resolvedFileName && !result.isExternalLibraryImport) {
      const resolvedPath = path.resolve(result.resolvedFileName)
      if (isInside(sourceRoot, resolvedPath)) return resolvedPath
    }

    if (specifier.startsWith(".") || specifier.startsWith("@/")) {
      throw new Error(`Could not resolve local import "${specifier}" in ${path.relative(root, containingFile)}`)
    }

    return null
  }

  function analyzeFile(filePath) {
    const normalizedPath = path.resolve(filePath)
    if (visited.has(normalizedPath)) return
    visited.add(normalizedPath)

    for (const specifier of collectModuleSpecifiers(normalizedPath)) {
      const resolvedPath = resolveImport(specifier, normalizedPath)

      if (!resolvedPath) {
        addPackageDependency(specifier, dependencies, devDependencies)
        continue
      }

      if (componentNames.has(resolvedPath)) {
        if (resolvedPath !== path.resolve(componentPath)) {
          componentDependencies.add(componentNames.get(resolvedPath))
        }
        continue
      }

      if (!localFiles.has(resolvedPath)) {
        localFiles.set(resolvedPath, getRegistryFile(resolvedPath))
      }
      analyzeFile(resolvedPath)
    }
  }

  analyzeFile(componentPath)

  const registryDependencies = [...componentDependencies]
    .sort()
    .map((dependency) =>
      githubRepository
        ? `${githubRepository}/${dependency}`
        : `./${dependency}.json`
    )

  const item = {
    name,
    type: "registry:ui",
    title: getTitle(name),
    description: `${getTitle(name)} component from ${packageJson.name}.`,
    files: [
      getRegistryFile(componentPath),
      ...[...localFiles.values()].sort((left, right) =>
        left.path.localeCompare(right.path)
      ),
    ],
  }

  if (registryDependencies.length > 0) {
    item.registryDependencies = registryDependencies
  }
  if (dependencies.size > 0) {
    item.dependencies = [...dependencies].sort()
  }
  if (devDependencies.size > 0) {
    item.devDependencies = [...devDependencies].sort()
  }

  packageItems.push(item)
}

const homepage =
  options.homepage ??
  (githubRepository
    ? `https://github.com/${githubRepository}`
    : packageJson.homepage ?? "http://localhost:3000")

const registry = {
  $schema: "https://ui.shadcn.com/schema/registry.json",
  name: packageJson.name,
  homepage,
  items: packageItems,
}

const outputPath = path.join(root, "registry.json")
await fs.writeFile(outputPath, `${JSON.stringify(registry, null, 2)}\n`)

console.log(
  `Generated registry.json with ${packageItems.length} items from ${path.relative(root, uiRoot)}.`
)
console.log(
  githubRepository
    ? `GitHub dependencies target ${githubRepository}.`
    : "Relative item dependencies are configured for static hosting."
)
