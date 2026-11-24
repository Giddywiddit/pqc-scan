import type { Node } from 'web-tree-sitter';
import { finding } from './finding.ts';
import type { Finding } from './types.ts';

// Helpers for tree-sitter syntax trees that every grammar shares.

/** Escapes text for use inside a regular expression. */
export const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The arguments of a call node (`arguments` field), in order. */
export const argumentsOf = (call: Node): Node[] => call.childForFieldName('arguments')?.namedChildren ?? [];

/** Whether any ancestor of `node` has one of `types`. */
export function hasAncestor(node: Node, types: string | readonly string[]): boolean {
  const wanted = typeof types === 'string' ? [types] : types;
  for (let current = node.parent; current; current = current.parent) if (wanted.includes(current.type)) return true;
  return false;
}

/**
 * The parts of a `::` path, with generic or template arguments left out (they are matched on their own):
 * `::CryptoPP::GCM<CryptoPP::AES>::Encryption` → [CryptoPP, GCM, Encryption], `hmac::Hmac::<Sha256>::new` → [hmac, Hmac, new].
 */
export function segments(text: string): string[] {
  let depth = 0;
  let plain = '';
  for (const char of text) {
    if (char === '<') depth++;
    else if (char === '>') depth = Math.max(0, depth - 1);
    else if (depth === 0) plain += char;
  }
  return plain.replace(/\s+/g, '').replace(/^::/, '').split('::').filter(Boolean);
}

/** How many bytes the parser could not read, given its ERROR nodes in source order (nested ones counted once). */
export function unreadableBytes(errors: Node[]): number {
  let bytes = 0;
  let end = -1;
  for (const node of errors) {
    if (node.startIndex >= end) bytes += node.endIndex - node.startIndex;
    end = Math.max(end, node.endIndex);
  }
  return bytes;
}

/**
 * Fail closed: a known crypto name inside a region the parser could not read is reported as unresolved, not dropped.
 * `patterns` are tried in order on each line, each with how to describe what it found ("a call to", "a use of"); the
 * first group of a match is the name shown.
 */
export function unreadableFindings(regions: Node[], patterns: [RegExp, string][], file: string, where: string, reportedLines: Set<number>): Finding[] {
  const findings: Finding[] = [];
  for (const region of regions) {
    region.text.split('\n').forEach((content, offset) => {
      const line = region.startPosition.row + 1 + offset;
      const found = patterns.map(([pattern, what]) => [pattern.exec(content)?.[1], what] as const).find(([name]) => name);
      if (found && !reportedLines.has(line)) {
        reportedLines.add(line);
        findings.push(finding(file, line, 'parse-error', 'unknown', null, 'unresolved', `Looks like ${found[1]} ${found[0]}${where}, but this part of the file could not be parsed.`));
      }
    });
  }
  return findings;
}
