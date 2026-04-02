// Privacy Shield — PII Scrubbing & Prompt Injection Detection
// Sub-millisecond regex-based scanning for real-time protection

import type { PIIMatch, PrivacyScanResult } from "../core/types.ts";

// ─── PII Patterns ────────────────────────────────────────────────────────────

interface PIIPattern {
	type: PIIMatch["type"];
	pattern: RegExp;
	redactChar: string;
}

const PII_PATTERNS: PIIPattern[] = [
	{
		type: "email",
		pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
		redactChar: "[EMAIL_REDACTED]",
	},
	{
		type: "phone",
		pattern: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
		redactChar: "[PHONE_REDACTED]",
	},
	{
		type: "ssn",
		pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
		redactChar: "[SSN_REDACTED]",
	},
	{
		type: "credit_card",
		pattern: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
		redactChar: "[CC_REDACTED]",
	},
	{
		type: "ip_address",
		pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
		redactChar: "[IP_REDACTED]",
	},
];

// ─── Prompt Injection Patterns ───────────────────────────────────────────────

const INJECTION_PATTERNS: RegExp[] = [
	/ignore\s+(all\s+)?previous\s+instructions/i,
	/you\s+are\s+now\s+(?:a|an)\s+/i,
	/disregard\s+(?:all\s+)?(?:prior|previous)/i,
	/forget\s+(?:all\s+)?(?:your|previous)\s+(?:instructions|rules|training)/i,
	/(?:system|admin)\s*:\s*(?:override|bypass|ignore)/i,
	/\[INST\]/i,
	/<\|im_start\|>/i,
	/<<SYS>>/i,
	/###\s*NEW\s*INSTRUCTION/i,
	/DO\s+NOT\s+FOLLOW\s+(?:THE\s+)?(?:ABOVE|PREVIOUS)/i,
];

// ─── Scan Functions ──────────────────────────────────────────────────────────

export function scanPII(text: string): PrivacyScanResult {
	const piiDetected: PIIMatch[] = [];
	const sanitized = text;

	// Scan for PII
	for (const { type, pattern, redactChar } of PII_PATTERNS) {
		const regex = new RegExp(pattern.source, pattern.flags);
		let match = regex.exec(text);
		while (match !== null) {
			piiDetected.push({
				type,
				original: match[0],
				redacted: redactChar,
				start: match.index,
				end: match.index + match[0].length,
			});
			match = regex.exec(text);
		}
	}

	// Check for prompt injection
	let injectionDetected = false;
	for (const pattern of INJECTION_PATTERNS) {
		if (pattern.test(text)) {
			injectionDetected = true;
			break;
		}
	}

	return {
		original: text,
		sanitized,
		piiDetected,
		injectionDetected,
		blocked: injectionDetected,
	};
}

export function sanitizeText(text: string): string {
	let sanitized = text;

	for (const { pattern, redactChar } of PII_PATTERNS) {
		sanitized = sanitized.replace(
			new RegExp(pattern.source, pattern.flags),
			redactChar,
		);
	}

	return sanitized;
}

export function checkInjection(text: string): boolean {
	return INJECTION_PATTERNS.some((p) => p.test(text));
}

// ─── Batch Scanning ──────────────────────────────────────────────────────────

export function scanBatch(texts: string[]): PrivacyScanResult[] {
	return texts.map(scanPII);
}

export function sanitizeBatch(texts: string[]): string[] {
	return texts.map(sanitizeText);
}

export default {
	scanPII,
	sanitizeText,
	checkInjection,
	scanBatch,
	sanitizeBatch,
};
