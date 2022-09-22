/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import Parser = require('web-tree-sitter');
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { ITextModel } from 'vs/editor/common/model';
import { URI } from 'vs/base/common/uri';
import { FileAccess } from 'vs/base/common/network';
import { TreeSitterTree as TreeSitterTree } from 'vs/editor/browser/services/treeSitterServices/treeSitterTree';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IModelService } from 'vs/editor/common/services/model';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { IFileService } from 'vs/platform/files/common/files';

export const ITreeSitterService = createDecorator<ITreeSitterService>('ITreeSitterService');

export interface ITreeSitterService {
	readonly _serviceBrand: undefined;
	getTreeSitterCaptures(model: ITextModel, queryString: string, asychronous?: boolean): Promise<Parser.QueryCapture[]>;
	registerLanguage(language: string, uri: string): void;
	getTreeSitterTree(model: ITextModel): Promise<TreeSitterTree>;
}

export class TreeSitterService implements ITreeSitterService {

	readonly _serviceBrand: undefined;
	private _language: Parser.Language | undefined = undefined;
	private _trees: Map<URI, TreeSitterTree> = new Map();
	private readonly _store: DisposableStore = new DisposableStore();
	private readonly _fileService: IFileService;
	private supportedLanguages = new Map<string, string>([
		['typescript', './tree-sitter-typescript.wasm']
	]);

	constructor(
		@IModelService _modelService: IModelService,
		@IFileService _fileservice: IFileService
	) {
		this._fileService = _fileservice;
		this._store.add(_modelService.onModelRemoved((model) => {
			if (this._trees.has(model.uri)) {
				const treeSitterTree = this._trees.get(model.uri);
				this._trees.delete(model.uri);
				treeSitterTree!.dispose();
			}
		}));
	}

	public registerLanguage(language: string, uri: string): void {
		this.supportedLanguages.set(language, uri);
	}

	public async getTreeSitterCaptures(model: ITextModel, queryString: string, asychronous: boolean = true): Promise<Parser.QueryCapture[]> {
		if (!this._language) {
			return this.fetchLanguage(model.getLanguageId()).then((language) => {
				this._language = language;
				return this._getTreeSitterCaptures(model, queryString, asychronous);
			})
		} else {
			return this._getTreeSitterCaptures(model, queryString, asychronous);
		}
	}

	private async _getTreeSitterCaptures(model: ITextModel, queryString: string, asychronous: boolean = true): Promise<Parser.QueryCapture[]> {
		if (!this._language) {
			throw new Error('Parser language should be defined');
		}
		if (!this._trees.has(model.uri)) {
			this._trees.set(model.uri, new TreeSitterTree(model, this._language));
		}
		const tree = this._trees.get(model.uri);
		const parsedTree = await tree!.parseTree(asychronous);
		const query = this._language.query(queryString);
		const captures = query.captures(parsedTree.rootNode);
		query.delete();
		return captures;
	}

	public async getTreeSitterTree(model: ITextModel): Promise<TreeSitterTree> {
		if (!this._language) {
			return this.fetchLanguage(model.getLanguageId()).then((language) => {
				this._language = language;
				return this._getTreeSitterTree(model);
			})
		} else {
			return this._getTreeSitterTree(model);
		}
	}

	private _getTreeSitterTree(model: ITextModel): TreeSitterTree {
		if (!this._language) {
			throw new Error('Parser language should be defined');
		}
		if (this._trees.has(model.uri)) {
			return this._trees.get(model.uri)!;
		} else {
			this._trees.set(model.uri, new TreeSitterTree(model, this._language));
			return this._trees.get(model.uri)!;
		}
	}

	private async fetchLanguage(language: string): Promise<Parser.Language> {
		if (!this.supportedLanguages.has(language)) {
			throw new Error('Unsupported language in tree-sitter');
		}
		const languageFile = await this._fileService.readFile(FileAccess.asFileUri(this.supportedLanguages.get(language)!, require));
		return Parser.Language.load(languageFile.value.buffer).then((language: Uint8Array) => {
			return new Promise(function (resolve, _reject) {
				resolve(language);
			})
		})
	}

	dispose(): void {
		for (const tree of this._trees.values()) {
			tree.dispose();
		}
		this._store.dispose();
	}
}

registerSingleton(ITreeSitterService, TreeSitterService, true);
