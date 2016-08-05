/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as nls from 'vs/nls';
import {onUnexpectedError} from 'vs/base/common/errors';
import {matchesFuzzy} from 'vs/base/common/filters';
import {TPromise} from 'vs/base/common/winjs.base';
import {IContext, IHighlight, QuickOpenEntryGroup, QuickOpenModel} from 'vs/base/parts/quickopen/browser/quickOpenModel';
import {IAutoFocus, Mode} from 'vs/base/parts/quickopen/common/quickOpen';
import {IKeybindingService} from 'vs/platform/keybinding/common/keybinding';
import {IEditorAction, ICommonCodeEditor, IEditor, EditorContextKeys} from 'vs/editor/common/editorCommon';
import {BaseEditorQuickOpenAction} from './editorQuickOpen';
import {ServicesAccessor} from 'vs/editor/common/editorCommonExtensions';
import {KeyCode, KeyMod} from 'vs/base/common/keyCodes';
import * as browser from 'vs/base/browser/browser';

export class EditorActionCommandEntry extends QuickOpenEntryGroup {
	private key: string;
	private action: IEditorAction;
	private editor: IEditor;

	constructor(key: string, highlights: IHighlight[], action: IEditorAction, editor: IEditor) {
		super();

		this.key = key;
		this.setHighlights(highlights);
		this.action = action;
		this.editor = editor;
	}

	public getLabel(): string {
		return this.action.label;
	}

	public getAriaLabel(): string {
		return nls.localize('ariaLabelEntry', "{0}, commands", this.getLabel());
	}

	public getGroupLabel(): string {
		return this.key;
	}

	public run(mode: Mode, context: IContext): boolean {
		if (mode === Mode.OPEN) {

			// Use a timeout to give the quick open widget a chance to close itself first
			TPromise.timeout(50).done(() => {

				// Some actions are enabled only when editor has focus
				this.editor.focus();

				if (this.action.enabled) {
					try {
						let promise = this.action.run() || TPromise.as(null);
						promise.done(null, onUnexpectedError);
					} catch (error) {
						onUnexpectedError(error);
					}
				}
			}, onUnexpectedError);

			return true;
		}

		return false;
	}
}

export class QuickCommandAction extends BaseEditorQuickOpenAction {

	constructor() {
		super(
			'editor.action.quickCommand',
			nls.localize('QuickCommandAction.label', "Command Palette"),
			'Command Palette',
			nls.localize('quickCommandActionInput', "Type the name of an action you want to execute")
		);

		this._precondition = EditorContextKeys.Focus;

		this.kbOpts = {
			kbExpr: EditorContextKeys.Focus,
			primary: (browser.isIE11orEarlier ? KeyMod.Alt | KeyCode.F1 : KeyCode.F1)
		};

		this.menuOpts = {
			kbExpr: EditorContextKeys.Focus
		};
	}

	public run(accessor:ServicesAccessor, editor:ICommonCodeEditor): void {
		const keybindingService = accessor.get(IKeybindingService);

		this._show(this.getController(editor), {
			getModel: (value:string):QuickOpenModel => {
				return new QuickOpenModel(this._editorActionsToEntries(keybindingService, editor, value));
			},

			getAutoFocus: (searchValue:string):IAutoFocus => {
				return {
					autoFocusFirstEntry: true,
					autoFocusPrefixMatch: searchValue
				};
			}
		});
	}

	private _sort(elementA: QuickOpenEntryGroup, elementB: QuickOpenEntryGroup): number {
		let elementAName = elementA.getLabel().toLowerCase();
		let elementBName = elementB.getLabel().toLowerCase();

		return elementAName.localeCompare(elementBName);
	}

	private _editorActionsToEntries(keybindingService:IKeybindingService, editor:ICommonCodeEditor, searchValue: string): EditorActionCommandEntry[] {
		let actions: IEditorAction[] = editor.getSupportedActions();
		let entries: EditorActionCommandEntry[] = [];

		for (let i = 0; i < actions.length; i++) {
			let action = actions[i];

			let keys = keybindingService.lookupKeybindings(action.id).map(k => keybindingService.getLabelFor(k));

			if (action.label) {
				let highlights = matchesFuzzy(searchValue, action.label);
				if (highlights) {
					entries.push(new EditorActionCommandEntry(keys.length > 0 ? keys.join(', ') : '', highlights, action, editor));
				}
			}
		}

		// Sort by name
		entries = entries.sort(this._sort);

		return entries;
	}
}
