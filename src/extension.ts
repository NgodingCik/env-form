import * as vscode from "vscode";
import { EnvEditorProvider } from "./editors/EnvEditorProvider";

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(EnvEditorProvider.register(context));
}

export function deactivate() {}
