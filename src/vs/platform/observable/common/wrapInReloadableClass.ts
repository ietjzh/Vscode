/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { isHotReloadEnabled } from 'vs/base/common/hotReload';
import { readHotReloadableExport } from 'vs/base/common/hotReloadHelpers';
import { IDisposable } from 'vs/base/common/lifecycle';
import { autorunWithStore } from 'vs/base/common/observable';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';

/**
 * Wrap a class in a reloadable wrapper.
 * When the wrapper is created, the original class is created.
 * When the original class changes, the instance is re-created.
*/
export function wrapInReloadableClass(getClass: () => (new (...args: any[]) => any)): (new (...args: any[]) => any) {
	// Disables this function as it does not work.
	if (1 === 1) {
		// TODO@hediet fix this asap.
		return getClass();
	}
	if (!isHotReloadEnabled()) {
		return getClass();
	}

	return class ReloadableWrapper extends BaseClass {
		private _autorun: IDisposable | undefined = undefined;

		override init() {
			this._autorun = autorunWithStore((reader, store) => {
				const clazz = readHotReloadableExport(getClass(), reader);
				store.add(this.instantiationService.createInstance(clazz));
			});
		}

		dispose(): void {
			this._autorun?.dispose();
		}
	};
}
class BaseClass {
	constructor(
		@IInstantiationService protected readonly instantiationService: IInstantiationService
	) {
		this.init();
	}

	init(): void { }
}
