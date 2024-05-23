/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Color } from 'vs/base/common/color';
import { Emitter, Event } from 'vs/base/common/event';
import { IconContribution } from 'vs/platform/theme/common/iconRegistry';
import { ColorScheme } from 'vs/platform/theme/common/theme';
import { IColorTheme, IFileIconTheme, IProductIconTheme, ITextMateThemingRule, IThemeService, ITokenStyle, ProbeScope } from 'vs/platform/theme/common/themeService';
import { TokenStyle } from 'vs/platform/theme/common/tokenClassificationRegistry';

export class TestColorTheme implements IColorTheme {

	public readonly label = 'test';

	constructor(
		private colors: { [id: string]: string | undefined } = {},
		public type = ColorScheme.DARK,
		public readonly semanticHighlighting = false
	) { }

	resolveScopes(scopes: ProbeScope[], definitions?: ITextMateThemingRule): TokenStyle | undefined {
		throw new Error('Method not implemented.');
	}

	getColor(color: string, useDefault?: boolean): Color | undefined {
		const value = this.colors[color];
		if (value) {
			return Color.fromHex(value);
		}
		return undefined;
	}

	defines(color: string): boolean {
		throw new Error('Method not implemented.');
	}

	getTokenStyleMetadata(type: string, modifiers: string[], modelLanguage: string): ITokenStyle | undefined {
		return undefined;
	}

	get tokenColorMap(): string[] {
		return [];
	}
}

class TestFileIconTheme implements IFileIconTheme {
	hasFileIcons = false;
	hasFolderIcons = false;
	hidesExplorerArrows = false;
}

class UnthemedProductIconTheme implements IProductIconTheme {
	getIcon(contribution: IconContribution) {
		return undefined;
	}
}

export class TestThemeService implements IThemeService {

	declare readonly _serviceBrand: undefined;
	_colorTheme: IColorTheme;
	_fileIconTheme: IFileIconTheme;
	_productIconTheme: IProductIconTheme;
	_onThemeChange = new Emitter<IColorTheme>();
	_onFileIconThemeChange = new Emitter<IFileIconTheme>();
	_onProductIconThemeChange = new Emitter<IProductIconTheme>();

	constructor(theme = new TestColorTheme(), fileIconTheme = new TestFileIconTheme(), productIconTheme = new UnthemedProductIconTheme()) {
		this._colorTheme = theme;
		this._fileIconTheme = fileIconTheme;
		this._productIconTheme = productIconTheme;
	}

	getColorTheme(): IColorTheme {
		return this._colorTheme;
	}

	setTheme(theme: IColorTheme) {
		this._colorTheme = theme;
		this.fireThemeChange();
	}

	fireThemeChange() {
		this._onThemeChange.fire(this._colorTheme);
	}

	public get onDidColorThemeChange(): Event<IColorTheme> {
		return this._onThemeChange.event;
	}

	getFileIconTheme(): IFileIconTheme {
		return this._fileIconTheme;
	}

	public get onDidFileIconThemeChange(): Event<IFileIconTheme> {
		return this._onFileIconThemeChange.event;
	}

	getProductIconTheme(): IProductIconTheme {
		return this._productIconTheme;
	}

	public get onDidProductIconThemeChange(): Event<IProductIconTheme> {
		return this._onProductIconThemeChange.event;
	}
}
