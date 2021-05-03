/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IExternalTerminalService } from 'vs/platform/externalTerminal/common/externalTerminal';

export const IExternalTerminalMainService = createDecorator<IExternalTerminalMainService>('externalTerminalMain');

export interface IExternalTerminalMainService extends IExternalTerminalService {
	readonly _serviceBrand: undefined;
}
