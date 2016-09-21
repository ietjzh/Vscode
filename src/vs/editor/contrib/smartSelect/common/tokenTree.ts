/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import {Position} from 'vs/editor/common/core/position';
import {Range} from 'vs/editor/common/core/range';
import {IModel, IPosition} from 'vs/editor/common/editorCommon';
import {LineToken} from 'vs/editor/common/core/lineTokens';
import {IRichEditBrackets} from 'vs/editor/common/modes';
import {ignoreBracketsInToken} from 'vs/editor/common/modes/supports';
import {BracketsUtils} from 'vs/editor/common/modes/supports/richEditBrackets';
import {LanguageConfigurationRegistry} from 'vs/editor/common/modes/languageConfigurationRegistry';

export const enum TokenTreeBracket {
	None = 0,
	Open = 1,
	Close = -1
}

export class Node {

	start: Position;

	end: Position;

	get range(): Range {
		return new Range(
			this.start.lineNumber,
			this.start.column,
			this.end.lineNumber,
			this.end.column
		);
	}

	parent: Node;
}

export class NodeList extends Node {

	children: Node[];

	get start(): Position {
		return this.hasChildren
			? this.children[0].start
			: this.parent.start;
	}

	get end(): Position {
		return this.hasChildren
			? this.children[this.children.length - 1].end
			: this.parent.end;
	}

	get hasChildren() {
		return this.children && this.children.length > 0;
	}

	get isEmpty() {
		return !this.hasChildren && !this.parent;
	}

	public append(node: Node): boolean {
		if (!node) {
			return false;
		}
		node.parent = this;
		if (!this.children) {
			this.children = [];
		}
		if (node instanceof NodeList) {
			if (node.children) {
				this.children.push.apply(this.children, node.children);
			}
		} else {
			this.children.push(node);
		}
		return true;
	}
}

export class Block extends Node {

	open: Node;
	close: Node;
	elements: NodeList;

	get start(): Position {
		return this.open.start;
	}

	get end(): Position {
		return this.close.end;
	}

	constructor() {
		super();
		this.elements = new NodeList();
		this.elements.parent = this;
	}
}

class Token {
	_tokenBrand: void;

	range: Range;
	type: string;
	bracket: TokenTreeBracket;

	constructor(range:Range, type: string, bracket: TokenTreeBracket) {
		this.range = range;
		this.type = type;
		this.bracket = bracket;
	}
}

function newNode(token: Token): Node {
	var node = new Node();
	node.start = token.range.getStartPosition();
	node.end = token.range.getEndPosition();
	return node;
}

class RawToken {
	_basicTokenBrand: void;

	public lineNumber: number;
	public lineText: string;
	public startOffset: number;
	public endOffset: number;
	public type: string;
	public modeId: string;

	constructor(source:LineToken, lineNumber:number, lineText:string) {
		this.lineNumber = lineNumber;
		this.lineText = lineText;
		this.startOffset = source.startOffset;
		this.endOffset = source.endOffset;
		this.type = source.type;
		this.modeId = source.modeId;
	}
}

class ModelRawTokenScanner {

	private _model: IModel;
	private _lineCount: number;
	private _versionId: number;
	private _lineNumber: number;
	private _lineText: string;
	private _next: LineToken;

	constructor(model:IModel) {
		this._model = model;
		this._lineCount = this._model.getLineCount();
		this._versionId = this._model.getVersionId();
		this._lineNumber = 0;
		this._lineText = null;
		this._advance();
	}

	private _advance(): void {
		this._next = (this._next ? this._next.next() : null);
		while (!this._next && this._lineNumber < this._lineCount) {
			this._lineNumber++;
			this._lineText = this._model.getLineContent(this._lineNumber);
			let currentLineTokens = this._model.getLineTokens(this._lineNumber);
			this._next = currentLineTokens.firstToken();
		}
	}

	public next(): RawToken {
		if (!this._next) {
			return null;
		}
		if (this._model.getVersionId() !== this._versionId) {
			return null;
		}

		let result = new RawToken(this._next, this._lineNumber, this._lineText);
		this._advance();
		return result;
	}
}

class TokenScanner {

	private _rawTokenScanner: ModelRawTokenScanner;
	private _nextBuff: Token[];

	private _cachedModeBrackets: IRichEditBrackets;
	private _cachedModeId: string;

	constructor(model: IModel) {
		this._rawTokenScanner = new ModelRawTokenScanner(model);
		this._nextBuff = [];
		this._cachedModeBrackets = null;
		this._cachedModeId = null;
	}

	next(): Token {
		if (this._nextBuff.length > 0) {
			return this._nextBuff.shift();
		}

		const token = this._rawTokenScanner.next();
		if (!token) {
			return null;
		}
		const lineNumber = token.lineNumber;
		const lineText = token.lineText;
		const tokenType = token.type;
		let startOffset = token.startOffset;
		const endOffset = token.endOffset;

		if (this._cachedModeId !== token.modeId) {
			this._cachedModeId = token.modeId;
			this._cachedModeBrackets = LanguageConfigurationRegistry.getBracketsSupport(this._cachedModeId);
		}
		const modeBrackets = this._cachedModeBrackets;

		if (!modeBrackets || ignoreBracketsInToken(tokenType)) {
			return new Token(
				new Range(lineNumber, startOffset + 1, lineNumber, endOffset + 1),
				tokenType,
				TokenTreeBracket.None
			);
		}

		let foundBracket: Range;
		do {
			foundBracket = BracketsUtils.findNextBracketInToken(modeBrackets.forwardRegex, lineNumber, lineText, startOffset, endOffset);
			if (foundBracket) {
				const foundBracketStartOffset = foundBracket.startColumn - 1;
				const foundBracketEndOffset = foundBracket.endColumn - 1;

				if (startOffset < foundBracketStartOffset) {
					// there is some text before this bracket in this token
					this._nextBuff.push(new Token(
						new Range(lineNumber, startOffset + 1, lineNumber, foundBracketStartOffset + 1),
						tokenType,
						TokenTreeBracket.None
					));
				}

				let bracketText = lineText.substring(foundBracketStartOffset, foundBracketEndOffset);
				bracketText = bracketText.toLowerCase();

				const bracketData = modeBrackets.textIsBracket[bracketText];
				const bracketIsOpen = modeBrackets.textIsOpenBracket[bracketText];

				this._nextBuff.push(new Token(
					new Range(lineNumber, foundBracketStartOffset + 1, lineNumber, foundBracketEndOffset + 1),
					`${bracketData.modeId};${bracketData.open};${bracketData.close}`,
					bracketIsOpen ? TokenTreeBracket.Open : TokenTreeBracket.Close
				));

				startOffset = foundBracketEndOffset;
			}
		} while(foundBracket);

		if (startOffset < endOffset) {
			// there is some remaining none-bracket text in this token
			this._nextBuff.push(new Token(
				new Range(lineNumber, startOffset + 1, lineNumber, endOffset + 1),
				tokenType,
				TokenTreeBracket.None
			));
		}

		return this._nextBuff.shift();
	}
}

class TokenTreeBuilder {

	private _scanner: TokenScanner;
	private _stack: Token[] = [];
	private _currentToken: Token;

	constructor(model: IModel) {
		this._scanner = new TokenScanner(model);
	}

	public build(): Node {
		var node = new NodeList();
		while (node.append(this._line() || this._any())) {
			// accept all
		}
		return node;
	}

	private _accept(condt: (info: Token) => boolean): boolean {
		var token = this._stack.pop() || this._scanner.next();
		if (!token) {
			return false;
		}
		var accepted = condt(token);
		if (!accepted) {
			this._stack.push(token);
			this._currentToken = null;
		} else {
			this._currentToken = token;
			//			console.log('accepted: ' + token.__debugContent);
		}
		return accepted;
	}

	private _peek(condt: (info: Token) => boolean): boolean {
		var ret = false;
		this._accept(info => {
			ret = condt(info);
			return false;
		});
		return ret;
	}

	private _line(): Node {
		var node = new NodeList(),
			lineNumber: number;

		// capture current linenumber
		this._peek(info => {
			lineNumber = info.range.startLineNumber;
			return false;
		});

		while (this._peek(info => info.range.startLineNumber === lineNumber)
			&& node.append(this._token() || this._block())) {

			// all children that started on this line
		}

		if (!node.children || node.children.length === 0) {
			return null;
		} else if (node.children.length === 1) {
			return node.children[0];
		} else {
			return node;
		}
	}

	private _token(): Node {
		if (!this._accept(token => token.bracket === TokenTreeBracket.None)) {
			return null;
		}
		return newNode(this._currentToken);
	}

	private _block(): Node {

		var bracketType: string,
			accepted: boolean;

		accepted = this._accept(token => {
			bracketType = token.type;
			return token.bracket === TokenTreeBracket.Open;
		});
		if (!accepted) {
			return null;
		}

		var bracket = new Block();
		bracket.open = newNode(this._currentToken);
		while (bracket.elements.append(this._line())) {
			// inside brackets
		}

		if (!this._accept(token => token.bracket === TokenTreeBracket.Close && token.type === bracketType)) {
			// missing closing bracket -> return just a node list
			var nodelist = new NodeList();
			nodelist.append(bracket.open);
			nodelist.append(bracket.elements);
			return nodelist;
		}

		bracket.close = newNode(this._currentToken);
		return bracket;
	}

	private _any(): Node {
		if (!this._accept(_ => true)) {
			return null;
		}
		return newNode(this._currentToken);
	}
}

/**
 * Parses this grammar:
 *	grammer = { line }
 *	line = { block | "token" }
 *	block = "open_bracket" { line } "close_bracket"
 */
export function build(model: IModel): Node {
	var node = new TokenTreeBuilder(model).build();
	return node;
}

export function find(node: Node, position: IPosition): Node {
	if (node instanceof NodeList && node.isEmpty) {
		return null;
	}

	if (!Range.containsPosition(node.range, position)) {
		return null;
	}

	var result: Node;

	if (node instanceof NodeList) {
		for (var i = 0, len = node.children.length; i < len && !result; i++) {
			result = find(node.children[i], position);
		}

	} else if (node instanceof Block) {
		result = find(node.open, position) || find(node.elements, position) || find(node.close, position);
	}

	return result || node;
}