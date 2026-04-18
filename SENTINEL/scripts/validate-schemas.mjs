#!/usr/bin/env node
/**
 * Validates every event schema under `schemas/` and every fixture under
 * `schemas/fixtures/`. Zero-dep — implements the subset of JSON Schema
 * draft-07 that these schemas actually use: type, required, properties,
 * items, enum, const, pattern, minimum, maximum, minItems, format
 * (date-time), oneOf.
 *
 * Exit 0 if every schema is self-consistent and every fixture meets its
 * label (valid → passes, invalid → fails). Exit 1 otherwise.
 */
import { readFileSync, readdirSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const schemasDir = join(root, "schemas");
const fixturesDir = join(schemasDir, "fixtures");

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function typeOf(value) {
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    if (Number.isInteger(value)) return "integer";
    return typeof value;
}

function typeMatches(actual, expected) {
    if (expected === "number") return actual === "number" || actual === "integer";
    return actual === expected;
}

/**
 * Returns an array of error strings. Empty array = valid.
 * Only supports the keywords listed in the module comment.
 */
function validate(value, schema, path = "$") {
    const errs = [];

    if (schema.oneOf) {
        const matches = schema.oneOf.filter((s) => validate(value, s, path).length === 0);
        if (matches.length !== 1) {
            errs.push(`${path}: expected exactly one oneOf branch to match, matched ${matches.length}`);
        }
        return errs;
    }

    if (schema.const !== undefined && value !== schema.const) {
        errs.push(`${path}: expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`);
    }

    if (schema.enum && !schema.enum.includes(value)) {
        errs.push(`${path}: value ${JSON.stringify(value)} not in enum ${JSON.stringify(schema.enum)}`);
    }

    if (schema.type) {
        const actual = typeOf(value);
        if (!typeMatches(actual, schema.type)) {
            errs.push(`${path}: expected type ${schema.type}, got ${actual}`);
            return errs;
        }
    }

    if (schema.type === "string" || typeof value === "string") {
        if (schema.pattern) {
            const re = new RegExp(schema.pattern);
            if (typeof value === "string" && !re.test(value)) {
                errs.push(`${path}: string does not match pattern ${schema.pattern}`);
            }
        }
        if (schema.format === "date-time" && typeof value === "string" && !ISO_DATETIME.test(value)) {
            errs.push(`${path}: string does not match format date-time`);
        }
    }

    if (schema.type === "number" || typeof value === "number") {
        if (schema.minimum !== undefined && value < schema.minimum) {
            errs.push(`${path}: ${value} < minimum ${schema.minimum}`);
        }
        if (schema.maximum !== undefined && value > schema.maximum) {
            errs.push(`${path}: ${value} > maximum ${schema.maximum}`);
        }
    }

    if (schema.type === "array" || Array.isArray(value)) {
        if (Array.isArray(value)) {
            if (schema.minItems !== undefined && value.length < schema.minItems) {
                errs.push(`${path}: ${value.length} < minItems ${schema.minItems}`);
            }
            if (schema.items) {
                for (let i = 0; i < value.length; i++) {
                    errs.push(...validate(value[i], schema.items, `${path}[${i}]`));
                }
            }
        }
    }

    if (schema.type === "object" || (value && typeof value === "object" && !Array.isArray(value))) {
        if (value && typeof value === "object" && !Array.isArray(value)) {
            for (const req of schema.required || []) {
                if (!(req in value)) {
                    errs.push(`${path}: missing required property "${req}"`);
                }
            }
            if (schema.properties) {
                for (const [key, sub] of Object.entries(schema.properties)) {
                    if (key in value) {
                        errs.push(...validate(value[key], sub, `${path}.${key}`));
                    }
                }
            }
        }
    }

    return errs;
}

function listJson(dir) {
    return readdirSync(dir)
        .filter((f) => extname(f) === ".json")
        .map((f) => join(dir, f));
}

function loadJson(path) {
    return JSON.parse(readFileSync(path, "utf-8"));
}

function check(cond, msg, failures) {
    if (!cond) failures.push(msg);
}

/* ------- schema self-consistency ------- */

const schemaFiles = listJson(schemasDir);
const failures = [];
const schemasByName = new Map();

for (const file of schemaFiles) {
    const name = basename(file, ".json");
    let schema;
    try {
        schema = loadJson(file);
    } catch (e) {
        failures.push(`${file}: invalid JSON (${e.message})`);
        continue;
    }
    schemasByName.set(name, schema);

    check(schema.$schema === "http://json-schema.org/draft-07/schema#", `${name}: $schema must be draft-07`, failures);
    check(schema.$id === name, `${name}: $id (${schema.$id}) must match filename`, failures);

    if (schema.oneOf) {
        check(
            Array.isArray(schema.oneOf) && schema.oneOf.length >= 2,
            `${name}: oneOf must be array of >= 2 branches`,
            failures,
        );
        for (const [i, branch] of (schema.oneOf || []).entries()) {
            check(
                branch.type === "object" && branch.properties?.schema?.const,
                `${name}: oneOf[${i}] must set schema.const`,
                failures,
            );
        }
    } else {
        check(schema.type === "object", `${name}: root type must be "object" (or use oneOf)`, failures);
        check(
            schema.properties?.schema?.const,
            `${name}: must set properties.schema.const (e.g. "${name}@1")`,
            failures,
        );
    }
}

/* ------- fixture validation ------- */

let fixtureCount = 0;
try {
    const fixtureFiles = listJson(fixturesDir);
    for (const file of fixtureFiles) {
        const fname = basename(file, ".json");
        const m = fname.match(/^(.+)\.(valid|invalid)$/);
        if (!m) {
            failures.push(`${file}: fixture name must end in .valid.json or .invalid.json`);
            continue;
        }
        const [, schemaName, label] = m;
        const schema = schemasByName.get(schemaName);
        if (!schema) {
            failures.push(`${file}: no schema named ${schemaName}.json`);
            continue;
        }
        let payload;
        try {
            payload = loadJson(file);
        } catch (e) {
            failures.push(`${file}: invalid JSON (${e.message})`);
            continue;
        }
        const errs = validate(payload, schema);
        if (label === "valid" && errs.length > 0) {
            failures.push(`${file}: fixture claims valid but failed with:\n    ${errs.join("\n    ")}`);
        }
        if (label === "invalid" && errs.length === 0) {
            failures.push(`${file}: fixture claims invalid but validated successfully`);
        }
        fixtureCount++;
    }
} catch (e) {
    failures.push(`fixtures/: ${e.message}`);
}

/* ------- every schema must have both fixtures ------- */

for (const name of schemasByName.keys()) {
    for (const label of ["valid", "invalid"]) {
        const path = join(fixturesDir, `${name}.${label}.json`);
        try {
            readFileSync(path);
        } catch {
            failures.push(`${name}: missing fixtures/${name}.${label}.json`);
        }
    }
}

/* ------- report ------- */

if (failures.length > 0) {
    console.error(`validate-schemas: ${failures.length} failure(s):\n`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
}

console.log(`validate-schemas: ${schemasByName.size} schema(s), ${fixtureCount} fixture(s) OK`);
