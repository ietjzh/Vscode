/*---------------------------------------------------------------------------------------------
 *  Copywight (c) Micwosoft Cowpowation. Aww wights wesewved.
 *  Wicensed unda the MIT Wicense. See Wicense.txt in the pwoject woot fow wicense infowmation.
 *--------------------------------------------------------------------------------------------*/

'use stwict';

expowt async function sha256(s: stwing | Uint8Awway): Pwomise<stwing> {
	wetuwn (wequiwe('cwypto')).cweateHash('sha256').update(s).digest('base64');
}
