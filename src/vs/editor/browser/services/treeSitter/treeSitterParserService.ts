/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TreeSitterTokenizationRegistry } from 'vs/editor/common/languages';
import { Parser } from 'vs/base/common/web-tree-sitter/tree-sitter-web';
import { AppResourcePath, FileAccess } from 'vs/base/common/network';
import { ITreeSitterParserService } from 'vs/editor/common/services/treeSitterParserService';
import { IModelService } from 'vs/editor/common/services/model';
import { Disposable, DisposableMap, DisposableStore, IDisposable } from 'vs/base/common/lifecycle';
import { ITextModel, ITextSnapshot } from 'vs/editor/common/model';
import { IFileService } from 'vs/platform/files/common/files';
import { Position } from 'vs/editor/common/core/position';
import { IModelContentChangedEvent, IModelLanguageChangedEvent } from 'vs/editor/common/textModelEvents';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { ILogService } from 'vs/platform/log/common/log';
import { Range } from 'vs/editor/common/core/range';

export class TreeSitterTree implements IDisposable {
	private _tree: Parser.Tree | undefined;
	private _language: Parser.Language | undefined;
	constructor(public readonly parser: Parser, private readonly disposables: DisposableStore) { }
	dispose(): void {
		this._tree?.delete();
		this.parser?.delete();
		this.disposables.dispose();
	}
	get tree() { return this._tree; }
	set tree(newTree: Parser.Tree | undefined) {
		this._tree?.delete();
		this._tree = newTree;
		this._snapshot = undefined;
		this._snapshotChunks = [];
	}
	get language() { return this._language; }
	set language(newLanguage: Parser.Language | undefined) {
		this.parser?.setLanguage(newLanguage);
		this._language = newLanguage;
		if (this._language === undefined) {
			this.tree = undefined;
		}
	}
	private _snapshot: ITextSnapshot | undefined;
	get snapshot() { return this._snapshot; }
	public createSnapshot(textModel: ITextModel) {
		this._snapshot = textModel.createSnapshot();
	}
	public clearSnapshot() {
		this._snapshot = undefined;
	}
	private _snapshotChunks: { chunk: string; startOffset: number }[] = [];
	get snapshotChunks() { return this._snapshotChunks; }
	public addSnapshotChunk(chunk: string, startOffset: number) {
		this._snapshotChunks.push({ chunk, startOffset });
	}
}

export class TreeSitterParserService extends Disposable implements ITreeSitterParserService {
	readonly _serviceBrand: undefined;
	private _init: Promise<void>;
	private _treeSitterTrees: DisposableMap<ITextModel, TreeSitterTree> = new DisposableMap();
	private _languages: Map<string, Parser.Language> = new Map();

	constructor(@IModelService private readonly _modelService: IModelService,
		@IFileService private readonly _fileService: IFileService,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
		@ILogService private readonly _logService: ILogService
	) {
		super();
		this._init = Parser.init({
			locateFile(_file: string, _folder: string) {
				const wasmPath: AppResourcePath = `vs/base/common/web-tree-sitter/tree-sitter.wasm`;
				return FileAccess.asBrowserUri(wasmPath).toString(true);
			}
		});
		// Eventually, this should actually use an extension point to add tree sitter grammars, but for now they are hard coded in core
		this._addGrammar('html', 'tree-sitter-html');
		this._addGrammar('typescript', 'tree-sitter-typescript');
		this._registerModelServiceListeners();

	}
	getLanguageLocation(languageId: string): AppResourcePath | undefined {
		const grammarName = TreeSitterTokenizationRegistry.get(languageId);
		if (!grammarName) {
			return undefined;
		}
		const languageLocation: AppResourcePath = `vs/base/common/treeSitterLanguages/${grammarName?.name}`;
		return languageLocation;
	}

	private _registerModelServiceListeners() {
		this._register(this._modelService.onModelAdded(model => {
			this._registerModelListeners(model);
		}));
		this._register(this._modelService.onModelRemoved(model => {
			this._treeSitterTrees.deleteAndDispose(model);
		}));
		this._modelService.getModels().forEach(model => this._registerModelListeners(model));
	}

	private async _registerModelListeners(model: ITextModel) {
		await this._init;
		const disposables = new DisposableStore();
		disposables.add(model.onDidChangeContent(e => this._onDidChangeContent(model, e)));
		disposables.add(model.onDidChangeLanguage(e => this._onDidChangeLanguage(model, e)));
		const parser = new Parser();
		const treeSitterTree = new TreeSitterTree(parser, disposables);
		this._treeSitterTrees.set(model, treeSitterTree);
		this._setLanguageAndTree(model, treeSitterTree);
	}

	private async _setLanguageAndTree(model: ITextModel, treeSitterTree: TreeSitterTree) {
		const languageId = model.getLanguageId();
		const language = await this._ensureLanguage(languageId);
		if (!language) {
			return;
		}
		treeSitterTree.language = language;
		treeSitterTree.tree = this._doInitialParse(model, treeSitterTree, languageId);
	}


	private _doInitialParse(model: ITextModel, treeSitterTree: TreeSitterTree, language: string): Parser.Tree {
		treeSitterTree.createSnapshot(model);
		const timer = performance.now();
		const newTree = treeSitterTree.parser.parse((index: number, position?: Parser.Point) => this._parseCallback(model, index, position, treeSitterTree));
		this.sendParseTimeTelemetry('fullParse', language, performance.now() - timer);
		return newTree;
	}

	private sendParseTimeTelemetry(eventName: string, languageId: string, time: number): void {
		this._logService.info(`Tree parsing (${eventName}) took ${time} ms`);
		type ParseTimeClassification = {
			owner: 'alros';
			comment: 'Used to understand how long it takes to parse a tree-sitter tree';
			languageId: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The programming language ID.' };
			time: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The ms it took to parse' };
		};
		this._telemetryService.publicLog2<{ languageId: string; time: number }, ParseTimeClassification>(`treeSitter.${eventName}`, { languageId, time });
	}

	private async _onDidChangeLanguage(model: ITextModel, e: IModelLanguageChangedEvent) {
		const tree = this._treeSitterTrees.get(model);
		if (!tree) {
			return;
		}
		const language = await this._ensureLanguage(e.newLanguage);
		if (!language) {
			// not supported for this language
			tree.language = undefined;
			return;
		}
		tree.language = language;
		const newTree = this._doInitialParse(model, tree, e.newLanguage);
		tree.tree = newTree;
	}

	private _onDidChangeContent(model: ITextModel, e: IModelContentChangedEvent) {
		const tree = this._treeSitterTrees.get(model);
		if (!tree?.language) {
			return;
		}
		for (const change of e.changes) {
			const newEndOffset = change.rangeOffset + change.text.length;
			const newEndPosition = model.getPositionAt(newEndOffset);
			// TODO @alexr00 need to take into account the previous edits in the loop (text edits class)
			tree.tree?.edit({
				startIndex: change.rangeOffset,
				oldEndIndex: change.rangeOffset + change.rangeLength,
				newEndIndex: change.rangeOffset + change.text.length,
				startPosition: { row: change.range.startLineNumber - 1, column: change.range.startColumn - 1 },
				oldEndPosition: { row: change.range.endLineNumber - 1, column: change.range.endColumn - 1 },
				newEndPosition: { row: newEndPosition.lineNumber - 1, column: newEndPosition.column - 1 }
			});
		}
		const timer = performance.now();
		tree.tree = tree.parser.parse((index: number, position?: Parser.Point) => this._parseCallback(model, index, position), tree.tree);
		this.sendParseTimeTelemetry('incrementalParse', model.getLanguageId(), performance.now() - timer);
	}

	private async _fetchLanguage(languageId: string): Promise<Parser.Language | undefined> {
		const grammarName = TreeSitterTokenizationRegistry.get(languageId);
		const languageLocation = this.getLanguageLocation(languageId);
		if (!grammarName || !languageLocation) {
			return undefined;
		}
		const wasmPath: AppResourcePath = `${languageLocation}/${grammarName.name}.wasm`;
		const languageFile = await (this._fileService.readFile(FileAccess.asFileUri(wasmPath)));
		return Parser.Language.load(languageFile.value.buffer);
	}

	private async _ensureLanguage(languageId: string): Promise<Parser.Language | undefined> {
		let language = this._languages.get(languageId);
		if (!language) {
			language = await this._fetchLanguage(languageId);
			if (!language) {
				return undefined;
			}
			this._languages.set(languageId, language);
		}
		return language;
	}

	private _parseCallback(textModel: ITextModel, index: number, position?: Parser.Point, treeSitterTree?: TreeSitterTree): string | null {
		if (treeSitterTree?.snapshot) {
			for (let i = 0; i < treeSitterTree.snapshotChunks.length; i++) {
				const snapshotChunk = treeSitterTree.snapshotChunks[i];
				if ((snapshotChunk.startOffset <= index) && (index < (snapshotChunk.chunk.length + snapshotChunk.startOffset))) {
					return snapshotChunk.chunk.substring(index - snapshotChunk.startOffset);
				}
			}

			let readValue = treeSitterTree.snapshot.read();
			if (readValue === null) {
				treeSitterTree.clearSnapshot();
			} else {
				const startOffset = treeSitterTree.snapshotChunks.length === 0 ? 0 : treeSitterTree.snapshotChunks[treeSitterTree.snapshotChunks.length - 1].startOffset + treeSitterTree.snapshotChunks[treeSitterTree.snapshotChunks.length - 1].chunk.length;
				treeSitterTree.addSnapshotChunk(readValue, startOffset);
				readValue = readValue.substring(index - startOffset);
			}
			return readValue;
		}
		try {
			const modelPositionStart: Position = position ? new Position(position.row + 1, position.column + 1) : textModel.getPositionAt(index);
			const lineContent = textModel.getLineContent(modelPositionStart.lineNumber);
			let value = lineContent.substring(modelPositionStart.column - 1);
			if (value.length === 0 && (lineContent.length <= modelPositionStart.column)) { // When we hit the end of the line the value is an empty string, we need to get the next character.
				const modelPositionEnd = textModel.getPositionAt(index + 2);
				value = textModel.getValueInRange(Range.fromPositions(modelPositionStart, modelPositionEnd));
			}
			return value;
		} catch (e) {
			return null;
		}
	}

	public initTreeSitter(): Promise<void> {
		return this._init;
	}

	getTree(model: ITextModel): Parser.Tree | undefined {
		return this._treeSitterTrees.get(model)?.tree;
	}

	getLanguage(model: ITextModel): Parser.Language | undefined {
		return this._treeSitterTrees.get(model)?.language;
	}

	private _addGrammar(languageId: string, grammarName: string) {
		TreeSitterTokenizationRegistry.register(languageId, { name: grammarName });
	}

	public override dispose(): void {
		super.dispose();
		this._treeSitterTrees.dispose();
	}
}
