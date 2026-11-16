#!/usr/bin/env node

import fs from "node:fs/promises"
import path from "node:path"
import process from "node:process"

const root = process.cwd()
const registryPath = path.join(root, "registry.json")
const packageJson = JSON.parse(
  await fs.readFile(path.join(root, "package.json"), "utf8")
)
const errors = []

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

function getPackageName(dependency) {
  const versionSeparator = dependency.startsWith("@")
    ? dependency.indexOf("@", dependency.indexOf("/") + 1)
    : dependency.indexOf("@")

  return versionSeparator === -1
    ? dependency
    : dependency.slice(0, versionSeparator)
}

function getLocalRegistryDependencyName(dependency) {
  if (dependency.startsWith("./") && dependency.endsWith(".json")) {
    return path.basename(dependency, ".json")
  }

  const githubDependency = dependency.split("#")[0].split("/")
  if (githubDependency.length === 3 && !dependency.startsWith("http")) {
    return githubDependency[2]
  }

  return null
}

function addError(message) {
  errors.push(message)
}

let registry
try {
  registry = JSON.parse(await fs.readFile(registryPath, "utf8"))
} catch (error) {
  console.error(`Registry validation failed: ${error.message}`)
  process.exit(1)
}

if (registry.$schema !== "https://ui.shadcn.com/schema/registry.json") {
  addError('registry.json has an invalid "$schema" value')
}
if (typeof registry.name !== "string" || registry.name.trim() === "") {
  addError('registry.json must define a non-empty "name"')
}
if (typeof registry.homepage !== "string" || registry.homepage.trim() === "") {
  addError('registry.json must define a non-empty "homepage"')
} else {
  try {
    new URL(registry.homepage)
  } catch {
    addError(`registry.json has an invalid homepage URL: ${registry.homepage}`)
  }
}
if (!Array.isArray(registry.items) || registry.items.length === 0) {
  addError('registry.json must contain a non-empty "items" array')
}

if (errors.length > 0) {
  console.error(`Registry validation failed with ${errors.length} error(s):`)
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

const itemNames = new Set()
const itemsByName = new Map()

for (const item of registry.items) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    addError("A registry item must be a JSON object")
    continue
  }

  if (typeof item.name !== "string" || item.name.trim() === "") {
    addError("A registry item has no valid name")
    continue
  }

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.name)) {
    addError(`Item "${item.name}" must use lowercase kebab-case`)
  }
  if (itemNames.has(item.name)) {
    addError(`Duplicate registry item name: ${item.name}`)
  }
  itemNames.add(item.name)
  itemsByName.set(item.name, item)

  if (item.type !== "registry:ui") {
    addError(`Item "${item.name}" must use type "registry:ui"`)
  }
  if (typeof item.title !== "string" || item.title.trim() === "") {
    addError(`Item "${item.name}" has no title`)
  }
  if (typeof item.description !== "string" || item.description.trim() === "") {
    addError(`Item "${item.name}" has no description`)
  }
  if (!Array.isArray(item.files) || item.files.length === 0) {
    addError(`Item "${item.name}" has no files`)
  }

  let hasPrimaryComponent = false
  const files = Array.isArray(item.files) ? item.files : []
  for (const file of files) {
    if (!file || typeof file !== "object" || Array.isArray(file)) {
      addError(`Item "${item.name}" has an invalid file entry`)
      continue
    }

    if (typeof file.path !== "string" || file.path.trim() === "") {
      addError(`Item "${item.name}" has a file without a path`)
      continue
    }

    const filePath = path.resolve(root, file.path)
    if (!isInside(root, filePath)) {
      addError(`Item "${item.name}" references a file outside the project: ${file.path}`)
      continue
    }

    try {
      const stat = await fs.stat(filePath)
      if (!stat.isFile()) {
        addError(`Item "${item.name}" file path is not a file: ${file.path}`)
      }
    } catch {
      addError(`Item "${item.name}" references a missing file: ${file.path}`)
    }

    if (
      file.path === `src/components/ui/${item.name}.tsx` &&
      file.type === "registry:ui"
    ) {
      hasPrimaryComponent = true
    }
    if (typeof file.target !== "string" || file.target.trim() === "") {
      addError(`Item "${item.name}" file has no target: ${file.path}`)
    }
  }
  if (!hasPrimaryComponent) {
    addError(`Item "${item.name}" has no matching primary UI component file`)
  }

  if (item.dependencies !== undefined && !Array.isArray(item.dependencies)) {
    addError(`Item "${item.name}" dependencies must be an array`)
  } else {
    for (const dependency of item.dependencies ?? []) {
      if (typeof dependency !== "string" || dependency.trim() === "") {
        addError(`Item "${item.name}" has an invalid npm dependency`)
        continue
      }

      const dependencyName = getPackageName(dependency)
      if (
        !packageJson.dependencies?.[dependencyName] &&
        !packageJson.devDependencies?.[dependencyName]
      ) {
        addError(
          `Item "${item.name}" uses "${dependencyName}", which is missing from package.json`
        )
      }
    }
  }

  if (item.registryDependencies !== undefined && !Array.isArray(item.registryDependencies)) {
    addError(`Item "${item.name}" registryDependencies must be an array`)
    continue
  }
  for (const dependency of item.registryDependencies ?? []) {
    if (typeof dependency !== "string" || dependency.trim() === "") {
      addError(`Item "${item.name}" has an invalid registry dependency`)
      continue
    }

  }
}

const componentPaths = (await fs.readdir(path.join(root, "src/components/ui")))
  .filter((fileName) => fileName.endsWith(".tsx"))
  .sort()
const componentNames = new Set(
  componentPaths.map((fileName) => path.basename(fileName, ".tsx"))
)

for (const componentName of componentNames) {
  if (!itemsByName.has(componentName)) {
    addError(`Component "${componentName}" is missing from registry.json`)
  }
}
for (const itemName of itemNames) {
  if (!componentNames.has(itemName)) {
    addError(`Registry item "${itemName}" has no source component`)
  }
}
for (const item of registry.items) {
  for (const dependency of item.registryDependencies ?? []) {
    const localDependencyName = getLocalRegistryDependencyName(dependency)
    if (localDependencyName && !itemsByName.has(localDependencyName)) {
      addError(
        `Item "${item.name}" depends on missing registry item "${localDependencyName}"`
      )
    }
  }
}

if (errors.length > 0) {
  console.error(`Registry validation failed with ${errors.length} error(s):`)
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

console.log(`Registry validation passed: ${registry.items.length} items.`)
