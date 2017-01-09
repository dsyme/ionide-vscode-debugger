import * as vscode from 'vscode';

const initialConfigurations = {
	version: '0.2.0',
	configurations: [
	{
		type: 'ionide',
		request: 'launch',
		name: 'Ionide-Debug',
		program: '${workspaceRoot}/${command.AskForProgramName}',
		stopOnEntry: true
	}
]}

export function activate(context: vscode.ExtensionContext) {

	let disposable = vscode.commands.registerCommand('IonideDebug.getProgramName', config => {
		return vscode.window.showInputBox({
			placeHolder: "Please enter the name of a markdown file in the workspace folder",
			value: "readme.md"
		});
	});
	context.subscriptions.push(disposable);

	context.subscriptions.push(vscode.commands.registerCommand('IonideDebug.provideInitialConfigurations', () => {
		return [
			JSON.stringify(initialConfigurations, null, '\t')
		].join('\n');
	}));
}

export function deactivate() {
}
