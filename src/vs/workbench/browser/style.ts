/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/style';
import { registerThemingParticipant } from 'vs/platform/theme/common/themeService';
import { WORKBENCH_BACKGROUND, TITLE_BAR_ACTIVE_BACKGROUND } from 'vs/workbench/common/theme';
import { isWeb, isIOS, isMacintosh, isWindows } from 'vs/base/common/platform';
import { createMetaElement } from 'vs/base/browser/dom';
import { isSafari, isStandalone } from 'vs/base/browser/browser';
import { isHighContrast } from 'vs/platform/theme/common/theme';

registerThemingParticipant((theme, collector) => {

	// Background (We need to set the workbench background color so that on Windows we get subpixel-antialiasing)
	const workbenchBackground = WORKBENCH_BACKGROUND(theme);
	collector.addRule(`.monaco-workbench { background-color: ${workbenchBackground}; }`);

	// High Contrast theme overwrites for outline
	if (isHighContrast(theme.type)) {
		collector.addRule(`
		.hc-black [tabindex="0"]:focus,
		.hc-black [tabindex="-1"]:focus,
		.hc-black .synthetic-focus,
		.hc-black select:focus,
		.hc-black input[type="button"]:focus,
		.hc-black input[type="text"]:focus,
		.hc-black textarea:focus,
		.hc-black input[type="checkbox"]:focus,
		.hc-light [tabindex="0"]:focus,
		.hc-light [tabindex="-1"]:focus,
		.hc-light .synthetic-focus,
		.hc-light select:focus,
		.hc-light input[type="button"]:focus,
		.hc-light input[type="text"]:focus,
		.hc-light textarea:focus,
		.hc-light input[type="checkbox"]:focus {
			outline-style: solid;
			outline-width: 1px;
		}

		.hc-black .synthetic-focus input,
		.hc-light .synthetic-focus input {
			background: transparent; /* Search input focus fix when in high contrast */
		}
		`);
	}

	// Update <meta name="theme-color" content=""> based on selected theme
	if (isWeb) {
		const titleBackground = theme.getColor(TITLE_BAR_ACTIVE_BACKGROUND);
		if (titleBackground) {
			const metaElementId = 'monaco-workbench-meta-theme-color';
			let metaElement = document.getElementById(metaElementId) as HTMLMetaElement | null;
			if (!metaElement) {
				metaElement = createMetaElement();
				metaElement.name = 'theme-color';
				metaElement.id = metaElementId;
			}

			metaElement.content = titleBackground.toString();
		}
	}

	// We disable user select on the root element, however on Safari this seems
	// to prevent any text selection in the monaco editor. As a workaround we
	// allow to select text in monaco editor instances.
	if (isSafari) {
		collector.addRule(`
			body.web {
				touch-action: none;
			}
			.monaco-workbench .monaco-editor .view-lines {
				user-select: text;
				-webkit-user-select: text;
			}
		`);
	}

	// Update body background color to ensure the home indicator area looks similar to the workbench
	if (isIOS && isStandalone()) {
		collector.addRule(`body { background-color: ${workbenchBackground}; }`);
	}
});

/**
 * The best font-family to be used in CSS based on the platform:
 * - Windows: Segoe preferred, fallback to sans-serif
 * - macOS: standard system font, fallback to sans-serif
 * - Linux: standard system font preferred, fallback to Ubuntu fonts
 *
 * Note: this currently does not adjust for different locales.
 */
export const DEFAULT_FONT_FAMILY = isWindows ? '"Segoe WPC", "Segoe UI", sans-serif' : isMacintosh ? '-apple-system, BlinkMacSystemFont, sans-serif' : 'system-ui, "Ubuntu", "Droid Sans", sans-serif';
