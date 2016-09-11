/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import Event, {Emitter} from 'vs/base/common/event';
import platform = require('vs/base/common/platform');
import {Builder} from 'vs/base/browser/builder';
import {IConfigurationService} from 'vs/platform/configuration/common/configuration';
import {IContextKeyService, IContextKey} from 'vs/platform/contextkey/common/contextkey';
import {IInstantiationService} from 'vs/platform/instantiation/common/instantiation';
import {IPanelService} from 'vs/workbench/services/panel/common/panelService';
import {IPartService} from 'vs/workbench/services/part/common/partService';
import {ITerminalInstance, ITerminalService, KEYBINDING_CONTEXT_TERMINAL_FOCUS, TERMINAL_PANEL_ID} from 'vs/workbench/parts/terminal/electron-browser/terminal';
import {TPromise} from 'vs/base/common/winjs.base';
import {TerminalConfigHelper} from 'vs/workbench/parts/terminal/electron-browser/terminalConfigHelper';
import {TerminalInstance} from 'vs/workbench/parts/terminal/electron-browser/terminalInstance';

export class TerminalService implements ITerminalService {
	public _serviceBrand: any;

	private _activeTerminalInstanceIndex: number = 0;
	private _configHelper: TerminalConfigHelper;
	private _onActiveInstanceChanged: Emitter<string>;
	private _onInstancesChanged: Emitter<string>;
	private _onInstanceTitleChanged: Emitter<string>;
	private _terminalInstances: ITerminalInstance[] = [];
	public get activeTerminalInstanceIndex(): number { return this._activeTerminalInstanceIndex; }
	public get configHelper(): TerminalConfigHelper { return this._configHelper; }
	public get onActiveInstanceChanged(): Event<string> { return this._onActiveInstanceChanged.event; }
	public get onInstancesChanged(): Event<string> { return this._onInstancesChanged.event; }
	public get onInstanceTitleChanged(): Event<string> { return this._onInstanceTitleChanged.event; }
	public get terminalInstances(): ITerminalInstance[] { return this._terminalInstances; }

	private terminalContainer: HTMLElement;
	private terminalFocusContextKey: IContextKey<boolean>;

	constructor(
		@IConfigurationService private configurationService: IConfigurationService,
		@IContextKeyService private contextKeyService: IContextKeyService,
		@IInstantiationService private instantiationService: IInstantiationService,
		@IPanelService private panelService: IPanelService,
		@IPartService private partService: IPartService
	) {
		this._onActiveInstanceChanged = new Emitter<string>();
		this._onInstancesChanged = new Emitter<string>();
		this._onInstanceTitleChanged = new Emitter<string>();
		this.terminalFocusContextKey = KEYBINDING_CONTEXT_TERMINAL_FOCUS.bindTo(this.contextKeyService);
		this._configHelper = <TerminalConfigHelper>this.instantiationService.createInstance(TerminalConfigHelper, platform.platform);
	}

	public createInstance(name?: string, shellPath?: string): ITerminalInstance {
		let terminalInstance = <TerminalInstance>this.instantiationService.createInstance(TerminalInstance,
			this.terminalFocusContextKey, this.onTerminalInstanceDispose.bind(this), this._configHelper, this.terminalContainer, name, shellPath);
		// TODO: Dispose this event handler when the terminalInstance is disposed
		terminalInstance.onTitleChanged(this._onInstanceTitleChanged.fire, this._onInstanceTitleChanged);
		this.terminalInstances.push(terminalInstance);
		if (this.terminalInstances.length === 1) {
			// It's the first instance so it should be made active automatically
			this.setActiveInstanceByIndex(0);
		}
		this._onInstancesChanged.fire();
		return terminalInstance;
	}

	public getInstanceLabels(): string[] {
		return this._terminalInstances.map((instance, index) => `${index + 1}: ${instance.title}`);
	}

	private onTerminalInstanceDispose(terminalInstance: TerminalInstance): void {
		let index = this.terminalInstances.indexOf(terminalInstance);
		let wasActiveInstance = terminalInstance === this.getActiveInstance();
		if (index !== -1) {
			this.terminalInstances.splice(index, 1);
		}
		if (wasActiveInstance && this.terminalInstances.length > 0) {
			let newIndex = index < this.terminalInstances.length ? index : this.terminalInstances.length - 1;
			this.setActiveInstanceByIndex(newIndex);
		}
		if (this.terminalInstances.length === 0) {
			this.hidePanel();
		}
		this._onInstancesChanged.fire();
		if (wasActiveInstance) {
			this._onActiveInstanceChanged.fire();
		}
	}

	public getActiveInstance(): ITerminalInstance {
		if (this.activeTerminalInstanceIndex < 0 || this.activeTerminalInstanceIndex >= this.terminalInstances.length) {
			return null;
		}
		return this.terminalInstances[this.activeTerminalInstanceIndex];
	}

	public getInstanceFromId(terminalId: number): ITerminalInstance {
		return this.terminalInstances[this.getIndexFromId(terminalId)];
	}

	public setActiveInstance(terminalInstance: ITerminalInstance): void {
		this.setActiveInstanceByIndex(this.getIndexFromId(terminalInstance.id));
	}

	public setActiveInstanceByIndex(terminalIndex: number): void {
		this._activeTerminalInstanceIndex = terminalIndex;
		this._terminalInstances.forEach((terminalInstance, i) => {
			terminalInstance.setVisible(i === terminalIndex);
		});
		this._onActiveInstanceChanged.fire();
	}

	public setActiveInstanceToNext(): void {
		if (this.terminalInstances.length <= 1) {
			return;
		}
		let newIndex = this._activeTerminalInstanceIndex + 1;
		if (newIndex >= this.terminalInstances.length) {
			newIndex = 0;
		}
		this.setActiveInstanceByIndex(newIndex);
	}

	public setActiveInstanceToPrevious(): void {
		if (this.terminalInstances.length <= 1) {
			return;
		}
		let newIndex = this._activeTerminalInstanceIndex - 1;
		if (newIndex < 0) {
			newIndex = this.terminalInstances.length - 1;
		}
		this.setActiveInstanceByIndex(newIndex);
	}

	public setContainers(panelContainer: Builder, terminalContainer: HTMLElement): void {
		this.terminalContainer = terminalContainer;
		this._terminalInstances.forEach(terminalInstance => {
			terminalInstance.attachToElement(this.terminalContainer);
		});
		this._configHelper.panelContainer = panelContainer;
	}

	public showPanel(focus?: boolean): TPromise<void> {
		return new TPromise<void>((complete) => {
			let panel = this.panelService.getActivePanel();
			if (!panel || panel.getId() !== TERMINAL_PANEL_ID) {
				return this.panelService.openPanel(TERMINAL_PANEL_ID, focus).then(() => {
					panel = this.panelService.getActivePanel();
					if (focus) {
						this.getActiveInstance().focus(true);
					}
					complete(void 0);
				});
			} else {
				if (focus) {
					this.getActiveInstance().focus(true);
				}
				complete(void 0);
			}
		});
	}

	public hidePanel(): void {
		const panel = this.panelService.getActivePanel();
		if (panel && panel.getId() === TERMINAL_PANEL_ID) {
			this.partService.setPanelHidden(true);
		}
	}

	public togglePanel(): TPromise<any> {
		const panel = this.panelService.getActivePanel();
		if (panel && panel.getId() === TERMINAL_PANEL_ID) {
			this.partService.setPanelHidden(true);
			return TPromise.as(null);
		}
		this.showPanel(true);
	}

	private getIndexFromId(terminalId: number): number {
		let terminalIndex = -1;
		this.terminalInstances.forEach((terminalInstance, i) => {
			if (terminalInstance.id === terminalId) {
				terminalIndex = i;
			}
		});
		if (terminalIndex === -1) {
			throw new Error(`Terminal with ID ${terminalId} does not exist (has it already been disposed?)`);
		}
		return terminalIndex;
	}
}

// import URI from 'vs/base/common/uri';
// import Event, {Emitter} from 'vs/base/common/event';
// import cp = require('child_process');
// import nls = require('vs/nls');
// import os = require('os');
// import path = require('path');
// import platform = require('vs/base/common/platform');
// import {Builder} from 'vs/base/browser/builder';
// import {EndOfLinePreference} from 'vs/editor/common/editorCommon';
// import {ICodeEditorService} from 'vs/editor/common/services/codeEditorService';
// import {IConfigurationService} from 'vs/platform/configuration/common/configuration';
// import {IContextKey, IContextKeyService} from 'vs/platform/contextkey/common/contextkey';
// import {IInstantiationService} from 'vs/platform/instantiation/common/instantiation';
// import {IMessageService, Severity} from 'vs/platform/message/common/message';
// import {IPanelService} from 'vs/workbench/services/panel/common/panelService';
// import {IPartService} from 'vs/workbench/services/part/common/partService';
// import {IStringDictionary} from 'vs/base/common/collections';
// import {ITerminalInstance, ITerminalPanel, ITerminalService, KEYBINDING_CONTEXT_TERMINAL_FOCUS, TERMINAL_PANEL_ID} from 'vs/workbench/parts/terminal/electron-browser/terminal';
// import {TerminalInstance} from 'vs/workbench/parts/terminal/electron-browser/terminalInstance';
// import {IWorkspaceContextService, IWorkspace} from 'vs/platform/workspace/common/workspace';
// import {TPromise} from 'vs/base/common/winjs.base';
// import {TerminalConfigHelper, IShell} from 'vs/workbench/parts/terminal/electron-browser/terminalConfigHelper';
// import {TerminalPanel} from 'vs/workbench/parts/terminal/electron-browser/terminalPanel';

// export class TerminalService implements ITerminalService {
// 	public _serviceBrand: any;

// 	private activeTerminalIndex: number = 0;
// 	private terminalProcesses: ITerminalProcess[] = [];
// 	private nextTerminalName: string;
// 	protected _terminalFocusContextKey: IContextKey<boolean>;

// 	private configHelper: TerminalConfigHelper;
// 	private _onActiveInstanceChanged: Emitter<string>;
// 	private _onInstancesChanged: Emitter<string>;
// 	private _onInstanceTitleChanged: Emitter<string>;

// 	constructor(
// 		@ICodeEditorService private codeEditorService: ICodeEditorService,
// 		@IConfigurationService private configurationService: IConfigurationService,
// 		@IContextKeyService private contextKeyService: IContextKeyService,
// 		@IMessageService private messageService: IMessageService,
// 		@IPanelService private panelService: IPanelService,
// 		@IPartService private partService: IPartService,
// 		@IWorkspaceContextService private contextService: IWorkspaceContextService
// 	) {
// 		this._onActiveInstanceChanged = new Emitter<string>();
// 		this._onInstancesChanged = new Emitter<string>();
// 		this._onInstanceTitleChanged = new Emitter<string>();
// 		this._terminalFocusContextKey = KEYBINDING_CONTEXT_TERMINAL_FOCUS.bindTo(this.contextKeyService);
// 	}

// 	public get onActiveInstanceChanged(): Event<string> {
// 		return this._onActiveInstanceChanged.event;
// 	}

// 	public get onInstancesChanged(): Event<string> {
// 		return this._onInstancesChanged.event;
// 	}

// 	public get onInstanceTitleChanged(): Event<string> {
// 		return this._onInstanceTitleChanged.event;
// 	}

// 	public setActiveTerminal(index: number): TPromise<any> {
// 		return this.show(false).then((terminalPanel) => {
// 			this.activeTerminalIndex = index;
// 			terminalPanel.setActiveTerminal(this.activeTerminalIndex);
// 			this._onActiveInstanceChanged.fire();
// 		});
// 	}

// 	public setActiveTerminalById(terminalId: number): void {
// 		this.setActiveTerminal(this.getTerminalIndexFromId(terminalId));
// 	}

// 	private getTerminalIndexFromId(terminalId: number): number {
// 		let terminalIndex = -1;
// 		this.terminalProcesses.forEach((terminalProcess, i) => {
// 			if (terminalProcess.process.pid === terminalId) {
// 				terminalIndex = i;
// 			}
// 		});
// 		if (terminalIndex === -1) {
// 			throw new Error(`Terminal with ID ${terminalId} does not exist (has it already been disposed?)`);
// 		}
// 		return terminalIndex;
// 	}

// 	public focusNext(): TPromise<any> {
// 		return this.focus().then((terminalPanel) => {
// 			if (this.terminalProcesses.length <= 1) {
// 				return;
// 			}
// 			this.activeTerminalIndex++;
// 			if (this.activeTerminalIndex >= this.terminalProcesses.length) {
// 				this.activeTerminalIndex = 0;
// 			}
// 			terminalPanel.setActiveTerminal(this.activeTerminalIndex);
// 			terminalPanel.focus();
// 			this._onActiveInstanceChanged.fire();
// 		});
// 	}

// 	public focusPrevious(): TPromise<any> {
// 		return this.focus().then((terminalPanel) => {
// 			if (this.terminalProcesses.length <= 1) {
// 				return;
// 			}
// 			this.activeTerminalIndex--;
// 			if (this.activeTerminalIndex < 0) {
// 				this.activeTerminalIndex = this.terminalProcesses.length - 1;
// 			}
// 			terminalPanel.setActiveTerminal(this.activeTerminalIndex);
// 			terminalPanel.focus();
// 			this._onActiveInstanceChanged.fire();
// 		});
// 	}

// 	public runSelectedText(): TPromise<any> {
// 		return this.focus().then((terminalPanel) => {
// 			let editor = this.codeEditorService.getFocusedCodeEditor();
// 			let selection = editor.getSelection();
// 			let text: string;
// 			if (selection.isEmpty()) {
// 				text = editor.getValue();
// 			} else {
// 				let endOfLinePreference = os.EOL === '\n' ? EndOfLinePreference.LF : EndOfLinePreference.CRLF;
// 				text = editor.getModel().getValueInRange(selection, endOfLinePreference);
// 			}
// 			terminalPanel.sendTextToActiveTerminal(text, true);
// 		});
// 	}

// 	public show(focus: boolean): TPromise<TerminalPanel> {
// 		return new TPromise<TerminalPanel>((complete) => {
// 			let panel = this.panelService.getActivePanel();
// 			if (!panel || panel.getId() !== TERMINAL_PANEL_ID) {
// 				return this.panelService.openPanel(TERMINAL_PANEL_ID, focus).then(() => {
// 					panel = this.panelService.getActivePanel();
// 					complete(<TerminalPanel>panel);
// 				});
// 			} else {
// 				if (focus) {
// 					panel.focus();
// 				}
// 				complete(<TerminalPanel>panel);
// 			}
// 		});
// 	}

// 	public focus(): TPromise<TerminalPanel> {
// 		return this.show(true);
// 	}

// 	public hide(): TPromise<any> {
// 		const panel = this.panelService.getActivePanel();
// 		if (panel && panel.getId() === TERMINAL_PANEL_ID) {
// 			this.partService.setPanelHidden(true);
// 		}
// 		return TPromise.as(void 0);
// 	}

// 	public hideTerminalInstance(terminalId: number): TPromise<any> {
// 		const panel = this.panelService.getActivePanel();
// 		if (panel && panel.getId() === TERMINAL_PANEL_ID) {
// 			if (this.terminalProcesses[this.getActiveTerminalIndex()].process.pid === terminalId) {
// 				this.partService.setPanelHidden(true);
// 			}
// 		}
// 		return TPromise.as(void 0);
// 	}

// 	public toggle(): TPromise<any> {
// 		const panel = this.panelService.getActivePanel();
// 		if (panel && panel.getId() === TERMINAL_PANEL_ID) {
// 			this.partService.setPanelHidden(true);
// 			return TPromise.as(null);
// 		}
// 		return this.focus();
// 	}

// 	public createNew(name?: string): TPromise<number> {
// 		let processCount = this.terminalProcesses.length;

// 		// When there are 0 processes it means that the panel is not yet created, so the name needs
// 		// to be stored for when createNew is called from TerminalPanel.create. This has to work
// 		// like this as TerminalPanel.setVisible must create a terminal if there is none due to how
// 		// the TerminalPanel is restored on launch if it was open previously.

// 		if (processCount === 0 && !name) {
// 			name = this.nextTerminalName;
// 			this.nextTerminalName = undefined;
// 		} else {
// 			this.nextTerminalName = name;
// 		}

// 		return this.focus().then((terminalPanel) => {
// 			// If the terminal panel has not been initialized yet skip this, the terminal will be
// 			// created via a call from TerminalPanel.setVisible
// 			if (terminalPanel === null) {
// 				return;
// 			}

// 			// Only create a new process if none have been created since toggling the terminal
// 			// panel. This happens when createNew is called when the panel is either empty or no yet
// 			// created.
// 			if (processCount !== this.terminalProcesses.length) {
// 				return TPromise.as(this.terminalProcesses[this.terminalProcesses.length - 1].process.pid);
// 			}

// 			this.initConfigHelper(terminalPanel.getContainer());
// 			return terminalPanel.createNewTerminalInstance(this.createTerminalProcess(name), this._terminalFocusContextKey).then((terminalId) => {
// 				this._onInstancesChanged.fire();
// 				return TPromise.as(terminalId);
// 			});
// 		});
// 	}

// 	public close(): TPromise<any> {
// 		return this.focus().then((terminalPanel) => {
// 			return terminalPanel.closeActiveTerminal();
// 		});
// 	}

// 	public closeById(terminalId: number): TPromise<any> {
// 		return this.show(false).then((terminalPanel) => {
// 			return terminalPanel.closeTerminalById(terminalId);
// 		});
// 	}

// 	public copySelection(): TPromise<any> {
// 		if (document.activeElement.classList.contains('xterm')) {
// 			document.execCommand('copy');
// 		} else {
// 			this.messageService.show(Severity.Warning, nls.localize('terminal.integrated.copySelection.noSelection', 'Cannot copy terminal selection when terminal does not have focus'));
// 		}
// 		return TPromise.as(void 0);
// 	}

// 	public paste(): TPromise<any> {
// 		return this.focus().then(() => {
// 			document.execCommand('paste');
// 		});
// 	}

// 	public scrollDown(): TPromise<any> {
// 		return this.focus().then((terminalPanel) => {
// 			terminalPanel.scrollDown();
// 		});
// 	}

// 	public scrollUp(): TPromise<any> {
// 		return this.focus().then((terminalPanel) => {
// 			terminalPanel.scrollUp();
// 		});
// 	}

// 	public getActiveTerminalIndex(): number {
// 		return this.activeTerminalIndex;
// 	}

// 	public getTerminalInstanceTitles(): string[] {
// 		return this.terminalProcesses.map((process, index) => `${index + 1}: ${process.title}`);
// 	}

// 	public initConfigHelper(panelElement: Builder): void {
// 		if (!this.configHelper) {
// 			this.configHelper = new TerminalConfigHelper(platform.platform, this.configurationService, panelElement);
// 		}
// 	}

// 	public killTerminalProcess(terminalProcess: ITerminalProcess): void {
// 		if (terminalProcess.process.connected) {
// 			terminalProcess.process.disconnect();
// 			terminalProcess.process.kill();
// 		}

// 		let index = this.terminalProcesses.indexOf(terminalProcess);
// 		if (index >= 0) {
// 			let wasActiveTerminal = (index === this.getActiveTerminalIndex());
// 			// Push active index back if the closed process was before the active process
// 			if (this.getActiveTerminalIndex() >= index) {
// 				this.activeTerminalIndex = Math.max(0, this.activeTerminalIndex - 1);
// 			}
// 			this.terminalProcesses.splice(index, 1);
// 			this._onInstancesChanged.fire();
// 			if (wasActiveTerminal) {
// 				this._onActiveInstanceChanged.fire();
// 			}
// 		}
// 	}

// 	private createTerminalProcess(name?: string): ITerminalProcess {
// 		let locale = this.configHelper.isSetLocaleVariables() ? platform.locale : undefined;
// 		let env = TerminalService.createTerminalEnv(process.env, this.configHelper.getShell(), this.contextService.getWorkspace(), locale);
// 		let terminalProcess = {
// 			title: name ? name : '',
// 			process: cp.fork('./terminalProcess', [], {
// 				env: env,
// 				cwd: URI.parse(path.dirname(require.toUrl('./terminalProcess'))).fsPath
// 			})
// 		};
// 		this.terminalProcesses.push(terminalProcess);
// 		this._onInstancesChanged.fire();
// 		this.activeTerminalIndex = this.terminalProcesses.length - 1;
// 		this._onActiveInstanceChanged.fire();
// 		if (!name) {
// 			// Only listen for process title changes when a name is not provided
// 			terminalProcess.process.on('message', (message) => {
// 				if (message.type === 'title') {
// 					terminalProcess.title = message.content ? message.content : '';
// 					this._onInstanceTitleChanged.fire();
// 				}
// 			});
// 		}
// 		return terminalProcess;
// 	}

// 	public static createTerminalEnv(parentEnv: IStringDictionary<string>, shell: IShell, workspace: IWorkspace, locale?: string): IStringDictionary<string> {
// 		let env = this.cloneEnv(parentEnv);
// 		env['PTYPID'] = process.pid.toString();
// 		env['PTYSHELL'] = shell.executable;
// 		shell.args.forEach((arg, i) => {
// 			env[`PTYSHELLARG${i}`] = arg;
// 		});
// 		env['PTYCWD'] = this.sanitizeCwd(workspace ? workspace.resource.fsPath : os.homedir());
// 		if (locale) {
// 			env['LANG'] = this.getLangEnvVariable(locale);
// 		}
// 		return env;
// 	}

// 	private static sanitizeCwd(cwd: string) {
// 		// Make the drive letter uppercase on Windows (see #9448)
// 		if (platform.platform === platform.Platform.Windows && cwd && cwd[1] === ':') {
// 			return cwd[0].toUpperCase() + cwd.substr(1);
// 		}
// 		return cwd;
// 	}

// 	private static cloneEnv(env: IStringDictionary<string>): IStringDictionary<string> {
// 		let newEnv: IStringDictionary<string> = Object.create(null);
// 		Object.keys(env).forEach((key) => {
// 			newEnv[key] = env[key];
// 		});
// 		return newEnv;
// 	}

// 	private static getLangEnvVariable(locale: string) {
// 		const parts = locale.split('-');
// 		const n = parts.length;
// 		if (n > 1) {
// 			parts[n - 1] = parts[n - 1].toUpperCase();
// 		}
// 		return parts.join('_') + '.UTF-8';
// 	}
// }

// export interface ITerminalProcessConfiguration {
// 	name: string;
// 	shell: IShell;
// }
