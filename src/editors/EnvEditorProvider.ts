import * as vscode from "vscode";

export class EnvEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = "envForm.customEditor";

  constructor(private readonly context: vscode.ExtensionContext) {}

  public static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new EnvEditorProvider(context);
    return vscode.window.registerCustomEditorProvider(
      EnvEditorProvider.viewType,
      provider,
      {
        webviewOptions: { retainContextWhenHidden: true },
      }
    );
  }

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "src/media"),
      ],
    };

    webviewPanel.webview.html = await this.getHtmlForWebview(
      webviewPanel.webview
    );

    const postUpdate = (): void => {
      webviewPanel.webview.postMessage({
        type: "update",
        text: document.getText(),
      });
    };

    const changeDocumentSubscription =
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.uri.toString() === document.uri.toString()) {
          postUpdate();
        }
      });

    webviewPanel.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case "ready":
          postUpdate();
          break;
        case "save":
          await this.updateTextDocument(document, message.text);
          break;
        case "importEnv":
          await this.handleImportEnv(webviewPanel.webview);
          break;
        case "openPlaintext":
          await this.openAsPlaintext(document.uri);
          break;
      }
    });

    webviewPanel.onDidDispose(() => changeDocumentSubscription.dispose());
  }

  /**
   * Opens a file picker and sends the full .env file text to the webview.
   * @param webview - The webview to post the imported text to
   */
  private async handleImportEnv(webview: vscode.Webview): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: false,
      openLabel: "Import .env",
      filters: {
        "Env Files": ["env", "*"],
        "All files": ["*"],
      },
    });

    if (uris && uris[0]) {
      const data = await vscode.workspace.fs.readFile(uris[0]);
      const text = Buffer.from(data).toString("utf8");
      webview.postMessage({ type: "importedEnv", text });
    }
  }

  /**
   * Reads index.html from disk, injects CSP/script/style URIs, and returns the HTML string.
   * @param webview - The webview instance used to convert local URIs
   */
  private async getHtmlForWebview(webview: vscode.Webview): Promise<string> {
    const htmlPath = vscode.Uri.joinPath(
      this.context.extensionUri,
      "src/media",
      "index.html"
    );
    const htmlBytes = await vscode.workspace.fs.readFile(htmlPath);
    let htmlText = Buffer.from(htmlBytes).toString("utf8");

    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "src/media", "index.css")
    );
    const jsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "src/media", "index.js")
    );

    htmlText = htmlText.replace(/{{cssUri}}/g, cssUri.toString());
    htmlText = htmlText.replace(/{{jsUri}}/g, jsUri.toString());
    htmlText = htmlText.replace(/{{cspSource}}/g, webview.cspSource);

    return htmlText;
  }

  /**
   * Replaces the entire content of the given document with newText.
   * @param document - The VS Code text document to update
   * @param newText - The full replacement text
   */
  private async updateTextDocument(
    document: vscode.TextDocument,
    newText: string
  ): Promise<void> {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      document.uri,
      new vscode.Range(0, 0, document.lineCount, 0),
      newText
    );
    await vscode.workspace.applyEdit(edit);
  }

  /**
   * Reopens the file with VS Code's default plaintext editor,
   * bypassing the custom webview editor.
   * @param uri - The document URI to reopen
   */
  private async openAsPlaintext(uri: vscode.Uri): Promise<void> {
    await vscode.commands.executeCommand("vscode.openWith", uri, "default");
  }
}