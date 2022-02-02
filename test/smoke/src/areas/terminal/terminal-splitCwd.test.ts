/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application, Terminal } from '../../../../automation';

export function setup() {
	describe.only('Terminal splitCwd', () => {
		// Acquire automation API
		let terminal: Terminal;
		before(async function () {
			const app = this.app as Application;
			terminal = app.workbench.terminal;
			await app.workbench.settingsEditor.addUserSetting('terminal.integrated.splitCwd', '"inherit"');
		});

		it('should inherit cwd when split and update the tab description', async () => {
			await terminal.createTerminal();
			const cwd = 'test';
			terminal.runCommandInTerminal(`mkdir ${cwd}`);
			terminal.runCommandInTerminal(`cd ${cwd}`);
			const page = await terminal.getPage();
			page.keyboard.down('Alt');
			await terminal.clickSingleTab();
			page.keyboard.up('Alt');
			await terminal.assertTerminalGroups([[{ description: cwd }, { description: cwd }]]);
		});
	});
}
