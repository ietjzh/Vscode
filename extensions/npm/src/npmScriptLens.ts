/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import {
	CodeLens,
	CodeLensProvider,
	Disposable,
	EventEmitter,
	languages,
	TextDocument,
	Uri,
	workspace
} from 'vscode';
import * as nls from 'vscode-nls';
import { findPreferredPM } from './preferred-pm';
import { readScripts } from './readScripts';
import { getNvmExecPath } from './tasks';

const localize = nls.loadMessageBundle();

const enum Constants {
	ConfigKey = 'debug.javascript.codelens.npmScripts',
}

const getFreshLensLocation = () => workspace.getConfiguration().get(Constants.ConfigKey);

/**
 * Npm script lens provider implementation. Can show a "Debug" text above any
 * npm script, or the npm scripts section.
 */
export class NpmScriptLensProvider implements CodeLensProvider, Disposable {
	private lensLocation = getFreshLensLocation();
	private changeEmitter = new EventEmitter<void>();
	private subscriptions: Disposable[] = [];

	/**
	 * @inheritdoc
	 */
	public onDidChangeCodeLenses = this.changeEmitter.event;

	constructor() {
		this.subscriptions.push(
			workspace.onDidChangeConfiguration(evt => {
				if (evt.affectsConfiguration(Constants.ConfigKey)) {
					this.lensLocation = getFreshLensLocation();
					this.changeEmitter.fire();
				}
			}),
			languages.registerCodeLensProvider(
				{
					language: 'json',
					pattern: '**/package.json',
				},
				this,
			)
		);
	}

	/**
	 * @inheritdoc
	 */
	public async provideCodeLenses(document: TextDocument): Promise<CodeLens[]> {
		if (this.lensLocation === 'never') {
			return [];
		}

		const tokens = readScripts(document);
		if (!tokens) {
			return [];
		}

		const title = localize('codelens.debug', '{0} Debug', '$(debug-start)');
		const cwd = path.dirname(document.uri.fsPath);
		if (this.lensLocation === 'top') {
			return [
				new CodeLens(
					tokens.location.range,
					{
						title,
						command: 'extension.js-debug.npmScript',
						arguments: [cwd],
					},
				),
			];
		}

		if (this.lensLocation === 'all') {
			const packageManager = await findPreferredPM(Uri.joinPath(document.uri, '..').fsPath);
			const nvmExecPath = getNvmExecPath(workspace.getWorkspaceFolder(document.uri)?.uri);
			return tokens.scripts.map(
				({ name, nameRange }) =>
					new CodeLens(
						nameRange,
						{
							title,
							command: 'extension.js-debug.createDebuggerTerminal',
							arguments: [`${nvmExecPath ? `${nvmExecPath} ` : ''}${packageManager.name} run ${name}`, workspace.getWorkspaceFolder(document.uri), { cwd }],
						},
					),
			);
		}

		return [];
	}

	/**
	 * @inheritdoc
	 */
	public dispose() {
		this.subscriptions.forEach(s => s.dispose());
	}
}
