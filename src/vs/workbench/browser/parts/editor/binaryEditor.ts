/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/binaryeditor';
import { localize } from 'vs/nls';
import { Emitter } from 'vs/base/common/event';
import { IEditorOpenContext } from 'vs/workbench/common/editor';
import { EditorInput } from 'vs/workbench/common/editor/editorInput';
import { EditorPane } from 'vs/workbench/browser/parts/editor/editorPane';
import { BinaryEditorModel } from 'vs/workbench/common/editor/binaryEditorModel';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { DomScrollableElement } from 'vs/base/browser/ui/scrollbar/scrollableElement';
import { ScrollbarVisibility } from 'vs/base/common/scrollable';
import { IThemeService, registerThemingParticipant } from 'vs/platform/theme/common/themeService';
import { Dimension, size, clearNode } from 'vs/base/browser/dom';
import { CancellationToken } from 'vs/base/common/cancellation';
import { DisposableStore, IDisposable, MutableDisposable } from 'vs/base/common/lifecycle';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { assertIsDefined, assertAllDefined } from 'vs/base/common/types';
import { ByteSize } from 'vs/platform/files/common/files';
import { IEditorOptions } from 'vs/platform/editor/common/editor';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { Link } from 'vs/platform/opener/browser/link';
import { SimpleIconLabel } from 'vs/base/browser/ui/iconLabel/simpleIconLabel';
import { editorWarningForeground } from 'vs/platform/theme/common/colorRegistry';
import { Codicon } from 'vs/base/common/codicons';

export interface IOpenCallbacks {
	openInternal: (input: EditorInput, options: IEditorOptions | undefined) => Promise<void>;
}

/*
 * This class is only intended to be subclassed and not instantiated.
 */
export abstract class BaseBinaryResourceEditor extends EditorPane {

	private readonly _onDidChangeMetadata = this._register(new Emitter<void>());
	readonly onDidChangeMetadata = this._onDidChangeMetadata.event;

	private readonly _onDidOpenInPlace = this._register(new Emitter<void>());
	readonly onDidOpenInPlace = this._onDidOpenInPlace.event;

	private metadata: string | undefined;
	private binaryContainer: HTMLElement | undefined;
	private scrollbar: DomScrollableElement | undefined;
	private inputDisposable = this._register(new MutableDisposable());

	constructor(
		id: string,
		private readonly callbacks: IOpenCallbacks,
		telemetryService: ITelemetryService,
		themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IInstantiationService private readonly instantiationService: IInstantiationService
	) {
		super(id, telemetryService, themeService, storageService);
	}

	override getTitle(): string {
		return this.input ? this.input.getName() : localize('binaryEditor', "Binary Viewer");
	}

	protected createEditor(parent: HTMLElement): void {

		// Container for Binary
		this.binaryContainer = document.createElement('div');
		this.binaryContainer.className = 'monaco-binary-resource-editor';
		this.binaryContainer.style.outline = 'none';
		this.binaryContainer.tabIndex = 0; // enable focus support from the editor part (do not remove)

		// Custom Scrollbars
		this.scrollbar = this._register(new DomScrollableElement(this.binaryContainer, { horizontal: ScrollbarVisibility.Auto, vertical: ScrollbarVisibility.Auto }));
		parent.appendChild(this.scrollbar.getDomNode());
	}

	override async setInput(input: EditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		const model = await input.resolve();

		// Check for cancellation
		if (token.isCancellationRequested) {
			return;
		}

		// Assert Model instance
		if (!(model instanceof BinaryEditorModel)) {
			throw new Error('Unable to open file as binary');
		}

		// Render Input
		this.inputDisposable.value = this.renderInput(input, options, model);
	}

	private renderInput(input: EditorInput, options: IEditorOptions | undefined, model: BinaryEditorModel): IDisposable {
		const [binaryContainer, scrollbar] = assertAllDefined(this.binaryContainer, this.scrollbar);

		clearNode(binaryContainer);

		const disposables = new DisposableStore();

		// Icon
		const iconContainer = document.createElement('div');
		iconContainer.classList.add('editor-placeholder-icon-container');
		binaryContainer.appendChild(iconContainer);

		const iconWidget = new SimpleIconLabel(iconContainer);
		iconWidget.text = '$(warning)';

		// Label
		const labelContainer = document.createElement('div');
		labelContainer.classList.add('editor-placeholder-label-container');
		binaryContainer.appendChild(labelContainer);

		const labelWidget = document.createElement('span');
		labelWidget.textContent = localize('nativeBinaryError', "The file is not displayed in the editor because it is either binary or uses an unsupported text encoding.");
		labelContainer.appendChild(labelWidget);

		// Actions
		const actionsContainer = document.createElement('div');
		actionsContainer.classList.add('editor-placeholder-actions-container');
		binaryContainer.appendChild(actionsContainer);

		disposables.add(this.instantiationService.createInstance(Link, actionsContainer, {
			label: localize('openAsText', "Do you want to open it anyway?"),
			href: ''
		}, {
			opener: async () => {

				// Open in place
				await this.callbacks.openInternal(input, options);

				// Signal to listeners that the binary editor has been opened in-place
				this._onDidOpenInPlace.fire();
			}
		}));

		scrollbar.scanDomNode();

		// Update metadata
		const size = model.getSize();
		this.handleMetadataChanged(typeof size === 'number' ? ByteSize.formatSize(size) : '');

		return disposables;
	}

	private handleMetadataChanged(meta: string | undefined): void {
		this.metadata = meta;

		this._onDidChangeMetadata.fire();
	}

	getMetadata(): string | undefined {
		return this.metadata;
	}

	override clearInput(): void {

		// Clear Meta
		this.handleMetadataChanged(undefined);

		// Clear the rest
		if (this.binaryContainer) {
			clearNode(this.binaryContainer);
		}
		this.inputDisposable.clear();

		super.clearInput();
	}

	layout(dimension: Dimension): void {

		// Pass on to Binary Container
		const [binaryContainer, scrollbar] = assertAllDefined(this.binaryContainer, this.scrollbar);
		size(binaryContainer, dimension.width, dimension.height);
		scrollbar.scanDomNode();
	}

	override focus(): void {
		const binaryContainer = assertIsDefined(this.binaryContainer);

		binaryContainer.focus();
	}

	override dispose(): void {
		this.binaryContainer?.remove();

		super.dispose();
	}
}

registerThemingParticipant((theme, collector) => {

	// Editor Placeholder Warning Icon
	const editorWarningIconForegroundColor = theme.getColor(editorWarningForeground);
	if (editorWarningIconForegroundColor) {
		collector.addRule(`
		.monaco-binary-resource-editor .editor-placeholder-icon-container ${Codicon.warning.cssSelector} {
			color: ${editorWarningIconForegroundColor};
		}`);
	}
});
