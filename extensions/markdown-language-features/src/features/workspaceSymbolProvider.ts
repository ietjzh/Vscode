/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { workspace, WorkspaceSymbolProvider, SymbolInformation, TextDocument } from 'vscode';
import { isMarkdownFile } from '../util/file';
import MDDocumentSymbolProvider from './documentSymbolProvider';
import { Dictionary, flatMap } from 'lodash';

export default class MarkdownWorkspaceSymbolProvider implements WorkspaceSymbolProvider {
	private symbolProvider: MDDocumentSymbolProvider;
	private symbolCache: Dictionary<SymbolInformation[]> = {};

	public constructor(symbolProvider: MDDocumentSymbolProvider) {
		this.symbolProvider = symbolProvider;
		this.populateSymbolCache();
		this.registerOnSaveEvent();
	}

	public async provideWorkspaceSymbols(query: string): Promise<SymbolInformation[]> {
		return flatMap(this.symbolCache)
			.filter(symbolInformation => symbolInformation.name.toLowerCase().indexOf(query.toLowerCase()) !== -1);
	}

	public async populateSymbolCache(): Promise<void> {
		const markDownDocumentUris = await workspace.findFiles('**/*.md');
		for (const uri of markDownDocumentUris) {
			const document = await workspace.openTextDocument(uri);
			if (isMarkdownFile(document)) {
				const symbols = await this.getSymbol(document);
				this.symbolCache[document.fileName] = symbols;
			}
		}
	}

	private async getSymbol(document: TextDocument): Promise<SymbolInformation[]> {
		return this.symbolProvider.provideDocumentSymbols(document);
	}

	private registerOnSaveEvent(): void {
		workspace.onDidSaveTextDocument(async document => {
			if (isMarkdownFile(document)) {
				const symbols = await this.getSymbol(document);
				this.symbolCache[document.fileName] = symbols;
			}
		});
	}

}