/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { BugIndicatingError } from 'vs/base/common/errors';
import { LineRange } from 'vs/editor/common/core/lineRange';
import { Range } from 'vs/editor/common/core/range';
import { AbstractText, SingleTextEdit } from 'vs/editor/common/core/textEdit';

/**
 * Maps a line range in the original text model to a line range in the modified text model.
 */
export class LineRangeMapping {
	public static inverse(mapping: readonly LineRangeMapping[], originalLineCount: number, modifiedLineCount: number): LineRangeMapping[] {
		const result: LineRangeMapping[] = [];
		let lastOriginalEndLineNumber = 1;
		let lastModifiedEndLineNumber = 1;

		for (const m of mapping) {
			const r = new LineRangeMapping(
				new LineRange(lastOriginalEndLineNumber, m.original.startLineNumber),
				new LineRange(lastModifiedEndLineNumber, m.modified.startLineNumber),
			);
			if (!r.modified.isEmpty) {
				result.push(r);
			}
			lastOriginalEndLineNumber = m.original.endLineNumberExclusive;
			lastModifiedEndLineNumber = m.modified.endLineNumberExclusive;
		}
		const r = new LineRangeMapping(
			new LineRange(lastOriginalEndLineNumber, originalLineCount + 1),
			new LineRange(lastModifiedEndLineNumber, modifiedLineCount + 1),
		);
		if (!r.modified.isEmpty) {
			result.push(r);
		}
		return result;
	}

	public static clip(mapping: readonly LineRangeMapping[], originalRange: LineRange, modifiedRange: LineRange): LineRangeMapping[] {
		const result: LineRangeMapping[] = [];
		for (const m of mapping) {
			const original = m.original.intersect(originalRange);
			const modified = m.modified.intersect(modifiedRange);
			if (original && !original.isEmpty && modified && !modified.isEmpty) {
				result.push(new LineRangeMapping(original, modified));
			}
		}
		return result;
	}

	/**
	 * The line range in the original text model.
	 */
	public readonly original: LineRange;

	/**
	 * The line range in the modified text model.
	 */
	public readonly modified: LineRange;

	constructor(
		originalRange: LineRange,
		modifiedRange: LineRange
	) {
		this.original = originalRange;
		this.modified = modifiedRange;
	}


	public toString(): string {
		return `{${this.original.toString()}->${this.modified.toString()}}`;
	}

	public flip(): LineRangeMapping {
		return new LineRangeMapping(this.modified, this.original);
	}

	public join(other: LineRangeMapping): LineRangeMapping {
		return new LineRangeMapping(
			this.original.join(other.original),
			this.modified.join(other.modified)
		);
	}

	public get changedLineCount() {
		return Math.max(this.original.length, this.modified.length);
	}


	public mapRange(): RangeMapping {
		const origRange = this.original.toInclusiveRange();
		const modRange = this.modified.toInclusiveRange();

		// Check if both ranges are defined
		if (origRange && modRange) {
			return new RangeMapping(origRange, modRange);
		}

		// Handle cases where start line number is 1
		if (this.original.startLineNumber === 1 || this.modified.startLineNumber === 1) {
			this.validateSingleStartAtFirstLine();
			return this.handleBothStartAtFirstLine();
		}

		// Assume start line numbers are greater than 1 for both
		return this.expandStartLineNumbers();
	}

	private validateSingleStartAtFirstLine(): void {
		if (!(this.modified.startLineNumber === 1 && this.original.startLineNumber === 1)) {
			throw new BugIndicatingError('not a valid diff');
		}
	}

	private handleBothStartAtFirstLine(): RangeMapping {
		return new RangeMapping(
			new Range(this.original.startLineNumber, 1, this.original.endLineNumberExclusive, 1),
			new Range(this.modified.startLineNumber, 1, this.modified.endLineNumberExclusive, 1),
		);
	}

	private expandStartLineNumbers(): RangeMapping {
		return new RangeMapping(
			new Range(this.original.startLineNumber - 1, Number.MAX_SAFE_INTEGER, this.original.endLineNumberExclusive - 1, Number.MAX_SAFE_INTEGER),
			new Range(this.modified.startLineNumber - 1, Number.MAX_SAFE_INTEGER, this.modified.endLineNumberExclusive - 1, Number.MAX_SAFE_INTEGER),
		);
	}
}

/**
 * Maps a line range in the original text model to a line range in the modified text model.
 * Also contains inner range mappings.
 */
export class DetailedLineRangeMapping extends LineRangeMapping {
	public static fromRangeMappings(rangeMappings: RangeMapping[]): DetailedLineRangeMapping {
		const originalRange = LineRange.join(rangeMappings.map(r => LineRange.fromRangeInclusive(r.originalRange)));
		const modifiedRange = LineRange.join(rangeMappings.map(r => LineRange.fromRangeInclusive(r.modifiedRange)));
		return new DetailedLineRangeMapping(originalRange, modifiedRange, rangeMappings);
	}

	/**
	 * If inner changes have not been computed, this is set to undefined.
	 * Otherwise, it represents the character-level diff in this line range.
	 * The original range of each range mapping should be contained in the original line range (same for modified), exceptions are new-lines.
	 * Must not be an empty array.
	 */
	public readonly innerChanges: RangeMapping[] | undefined;

	constructor(
		originalRange: LineRange,
		modifiedRange: LineRange,
		innerChanges: RangeMapping[] | undefined
	) {
		super(originalRange, modifiedRange);
		this.innerChanges = innerChanges;
	}

	public override flip(): DetailedLineRangeMapping {
		return new DetailedLineRangeMapping(this.modified, this.original, this.innerChanges?.map(c => c.flip()));
	}

	public withInnerChangesFromLineRanges(): DetailedLineRangeMapping {
		// return new DetailedLineRangeMapping(this.original, this.modified, [
		// 	new RangeMapping(this.original.toExclusiveRange(), this.modified.toExclusiveRange()),
		// ]);
		return new DetailedLineRangeMapping(this.original, this.modified, [this.mapRange()]);
	}
}

/**
 * Maps a range in the original text model to a range in the modified text model.
 */
export class RangeMapping {
	/**
	 * The original range.
	 */
	readonly originalRange: Range;

	/**
	 * The modified range.
	 */
	readonly modifiedRange: Range;

	constructor(
		originalRange: Range,
		modifiedRange: Range
	) {
		this.originalRange = originalRange;
		this.modifiedRange = modifiedRange;
	}

	public editText(targetText: AbstractText): SingleTextEdit {
		const extractedText = targetText.getValueOfRange(this.modifiedRange);
		return new SingleTextEdit(this.originalRange, extractedText);
	}

	public toString(): string {
		return `{${this.originalRange.toString()}->${this.modifiedRange.toString()}}`;
	}

	public flip(): RangeMapping {
		return new RangeMapping(this.modifiedRange, this.originalRange);
	}




}
