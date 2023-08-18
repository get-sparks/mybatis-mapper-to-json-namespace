import * as Fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import * as xml2js from "xml-js";

type Dict = NodeJS.Dict<any>;
type Configurations = { mapperPath?: string; mappers?: Dict; };
type MapperObj = { namespace: string, ids: string[]; };

export function activate(context: vscode.ExtensionContext)
{
	if (!Watch.isWatchConfig)
	{
		Watch.isWatchConfig = true;
		Watch.config.onDidChange(event => Watch.configWatcher(event.fsPath, context));
		Watch.config.onDidCreate(event => Watch.configWatcher(event.fsPath, context));
		Watch.config.onDidDelete(event => Watch.configWatcher(event.fsPath, context));

		context.subscriptions.push(Watch.config);
	}

	Watch.xmlWatcher(undefined);
}

const Utils =
{
	getWorkspacePath: (): string => vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0 ? vscode.workspace.workspaceFolders[0].uri.fsPath : "./",
	findXmlFiles: (dir: string): string[] =>
	{
		let results: string[] = [];

		const list = Fs.readdirSync(dir);

		list.forEach(file =>
		{
			const filePath = path.join(dir, file);
			const stat = Fs.statSync(filePath);

			if (stat && stat.isDirectory())
			{
				results = results.concat(Utils.findXmlFiles(filePath));
			}
			else
			{
				if (path.extname(filePath) === '.xml')
				{
					results.push(filePath);
				}
			}
		});

		return results;
	},

	parseObjects: (filepath: string): MapperObj =>
	{
		const tags = ["select", "insert", "update", "delete"];
		const result: MapperObj = { namespace: "", ids: [] };

		try
		{
			const data: Dict = JSON.parse(xml2js.xml2json(Fs.readFileSync(filepath, 'utf-8'), { compact: true }));

			if (data?.mapper?._attributes?.namespace)
			{
				let list: any = [];

				result.namespace = data.mapper._attributes.namespace;

				tags.map(tag =>
				{
					if (data.mapper[tag])
					{
						if (Array.isArray(data.mapper[tag]))
						{
							data.mapper[tag].map((obj: any) => list.push({ ...obj, _type: tag }));
						}
						else
						{
							list.push({ ...data.mapper[tag], _type: tag });
						}
					}
				});

				list.filter((o: any) => typeof o._attributes?.id !== "undefined").map((o: any) =>
				{
					const id = o._attributes.id;

					if (!result.ids.includes(id))
					{
						result.ids.push(id);
					}
				});
			}
		}
		catch (err)
		{
			console.error("Error parseObjects");
			console.error(err);

			throw err;
		}

		return result;
	}
};


const Config =
{
	path: path.join(Utils.getWorkspacePath(), ".mybatis.json"),
	get: (): Configurations =>
	{
		let result: Configurations = {};

		try
		{
			if (Fs.existsSync(Config.path) && Fs.statSync(Config.path).isFile())
			{
				const file: string = Fs.readFileSync(Config.path, { encoding: "utf8" });
				result = JSON.parse(file);
			}
		}
		catch (err)
		{
			console.error(err);
		}

		return result;
	},
	set: (str: string) =>
	{
		Fs.writeFileSync(Config.path, str, { encoding: "utf8" });
	},
	default: { mapperPath: "./mybatis", mappers: { namespaces: {}, ids: {} } }
};

const Watch =
{
	isWatchXml: false,
	isWatchConfig: false,

	/* XML Watcher */
	xml: vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(path.join(Utils.getWorkspacePath(), Config.get().mapperPath ?? "./.mybatis"), '**/*'), false, false, false),
	xmlWatcher: (file?: string) =>
	{
		try
		{
			const config: Configurations = { ...Config.default, ...Config.get() };
			const json: Dict = { mapperPath: config.mapperPath ?? "", mappers: { namespaces: {}, ids: {} } };

			if (config.mapperPath)
			{
				const xmlRoot: string = path.join(Utils.getWorkspacePath(), config.mapperPath);

				if (Fs.existsSync(xmlRoot) && Fs.statSync(xmlRoot).isDirectory())
				{
					const xmlFiles = Utils.findXmlFiles(xmlRoot);

					xmlFiles.map(xml =>
					{
						const obj = Utils.parseObjects(xml);

						if (obj.namespace)
						{
							json.mappers.namespaces[obj.namespace] = {};
							json.mappers.ids[obj.namespace] = {};

							obj.ids.map((m: string) =>
							{
								json.mappers.ids[obj.namespace][m] = {};
							});
						}
					});
				}
			}

			Config.set(JSON.stringify(json));
		}
		catch (e)
		{
			console.log(e);
			vscode.window.showErrorMessage('Error updating JSON from XML.');
		}
	},

	/* Config Watcher */
	config: vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(Utils.getWorkspacePath(), '*.json'), false, false, false),
	configWatcher: (filepath: string, context: vscode.ExtensionContext) =>
	{
		const config: Configurations = Config.get();

		if (config.mapperPath && !Watch.isWatchXml)
		{
			Watch.isWatchXml = true;
			Watch.xml.onDidChange(event => Watch.xmlWatcher(event.fsPath));
			Watch.xml.onDidCreate(event => Watch.xmlWatcher(event.fsPath));
			Watch.xml.onDidDelete(event => Watch.xmlWatcher(event.fsPath));

			context.subscriptions.push(Watch.xml);
		}
	}
};

