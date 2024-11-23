import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

export async function activate(context: vscode.ExtensionContext) {
    const provider = new RulesViewProvider(context.extensionUri);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(RulesViewProvider.viewType, provider));
}

class RulesViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = "markov-editor.rules";

    constructor(private readonly extensionUri: vscode.Uri) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        token: vscode.CancellationToken,
    ) {
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri],
        };

        const htmlPath = vscode.Uri.joinPath(this.extensionUri, "resources", "rulesView.html");
        const htmlContent = fs.readFileSync(htmlPath.fsPath, "utf-8");

        const styleVSCodeUri = webviewView.webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, "resources", "vscode.css"),
        );
        const codiconsUri = webviewView.webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, "node_modules", "@vscode/codicons", "dist", "codicon.css"),
        );

        webviewView.webview.onDidReceiveMessage((message) => console.log("message: ", message));

        webviewView.webview.html = htmlContent
            .replaceAll("{styleVSCodeUri}", styleVSCodeUri.toString())
            .replaceAll("{codiconsUri}", codiconsUri.toString())
            .replaceAll("{cspSource}", webviewView.webview.cspSource);
    }
}
