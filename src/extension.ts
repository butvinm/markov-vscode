import * as fs from "fs";
import * as vscode from "vscode";

export async function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(RulesViewProvider.viewType, new RulesViewProvider(context.extensionUri)),
    );
}

interface RuleData {
    pattern: string;
    sub: string;
}

interface Message {
    action: "preview" | "apply";
    rules: RuleData[];
}

interface Rule {
    pattern: RegExp;
    sub: string;
}

class RulesViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = "markov-editor.rules";

    private previews: Map<vscode.TextDocument, vscode.TextDocument> = new Map();

    constructor(private readonly extensionUri: vscode.Uri) {
        vscode.workspace.onDidCloseTextDocument((doc) => {
            this.previews.delete(doc);
        });
    }

    public resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext, token: vscode.CancellationToken) {
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri],
        };

        const htmlPath = vscode.Uri.joinPath(this.extensionUri, "resources", "rulesView.html");
        const htmlContent = fs.readFileSync(htmlPath.fsPath, "utf-8");

        const styleVSCodeUri = webviewView.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "resources", "vscode.css"));
        const codiconsUri = webviewView.webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, "node_modules", "@vscode/codicons", "dist", "codicon.css"),
        );

        webviewView.webview.onDidReceiveMessage((message) => this.handleViewMessage(message));

        webviewView.webview.html = htmlContent
            .replaceAll("{styleVSCodeUri}", styleVSCodeUri.toString())
            .replaceAll("{codiconsUri}", codiconsUri.toString())
            .replaceAll("{cspSource}", webviewView.webview.cspSource);
    }

    private handleViewMessage(message: Message) {
        const target = this.selectEditor();
        if (!target) {
            vscode.window.showErrorMessage("No active editor found.");
            return;
        }
        const { editor, preview } = target;

        const rules = message.rules.map(this.buildRule);
        switch (message.action) {
            case "apply":
                this.apply(editor, rules);
                if (preview) {
                    this.closePreview(preview);
                }
                break;
            case "preview":
                this.preview(editor, rules);
                break;
        }
    }

    /**
     * Returns either original editor of the preview or just an active editor itself.
     *
     * When we open preview it two new editors are opened for the original and modified documents.
     * Original editor in this case is considered "closed" and cannot be edited.
     * So we should find an active editor by corresponding document.
     */
    private selectEditor(): { editor: vscode.TextEditor; preview?: vscode.TextEditor } | null {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            return null;
        }

        const previewedDocument = this.previews.get(activeEditor.document);
        if (previewedDocument) {
            const previewedEditor = vscode.window.visibleTextEditors.find((editor) => editor.document == previewedDocument);
            if (previewedEditor) {
                return { editor: previewedEditor, preview: activeEditor };
            }
            return null;
        }
        return { editor: activeEditor };
    }

    private closePreview(preview: vscode.TextEditor) {
        vscode.workspace
            .openTextDocument(preview.document.uri)
            .then(() => vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor"))
            .then(() => this.previews.delete(preview.document));
    }

    private buildRule(ruleData: RuleData): Rule {
        return {
            pattern: new RegExp(ruleData.pattern, "g"),
            sub: ruleData.sub,
        };
    }

    private preview(editor: vscode.TextEditor, rules: Rule[]) {
        const modifiedText = this.modifyText(editor.document.getText(), rules);

        const previewedEditor = Array.from(this.previews.entries()).find(
            ([previewDocument, editorDocument]) => editorDocument == editor.document,
        );
        const preview = previewedEditor ? vscode.window.visibleTextEditors.find((editor) => editor.document == previewedEditor[0]) : null;

        if (preview) {
            // if preview is already opened, just update its content
            preview.edit((editBuilder) => {
                const entireRange = new vscode.Range(
                    editor.document.positionAt(0),
                    editor.document.positionAt(editor.document.getText().length),
                );
                editBuilder.replace(entireRange, modifiedText);
            });

            vscode.workspace.openTextDocument(preview.document.uri).then((preview) => {
                this.previews.set(preview, editor.document);
                vscode.commands.executeCommand(
                    "vscode.diff",
                    editor.document.uri,
                    preview.uri,
                    `Markov Preview: ${editor.document.fileName}`,
                );
            });
        } else {
            // open a new preview tab with diff between original and modified text
            vscode.workspace.openTextDocument({ content: modifiedText, language: editor.document.languageId }).then((preview) => {
                this.previews.set(preview, editor.document);
                vscode.commands.executeCommand(
                    "vscode.diff",
                    editor.document.uri,
                    preview.uri,
                    `Markov Preview: ${editor.document.fileName}`,
                );
            });
        }
    }

    private apply(editor: vscode.TextEditor, rules: Rule[]) {
        const modifiedText = this.modifyText(editor.document.getText(), rules);
        editor
            .edit((editBuilder) => {
                const entireRange = new vscode.Range(
                    editor.document.positionAt(0),
                    editor.document.positionAt(editor.document.getText().length),
                );
                editBuilder.replace(entireRange, modifiedText);
            })
            .then((success) => {
                if (success) {
                    vscode.window.showInformationMessage("Rules were applied successfully.");
                } else {
                    vscode.window.showErrorMessage("Failed to apply rules.");
                }
            });
    }

    private modifyText(text: string, rules: Rule[]): string {
        let modifiedText = text;

        for (const rule of rules) {
            let text = "";
            let cursor = 0;

            const matches = modifiedText.matchAll(rule.pattern);
            for (const match of matches) {
                text += modifiedText.slice(cursor, match.index);

                let sub = rule.sub;
                match.forEach((group, index) => {
                    sub = sub.replaceAll("$" + index.toString(), group);
                });

                text += sub;
                cursor = match.index + match[0].length;
            }
            text += modifiedText.slice(cursor);
            modifiedText = text;
        }
        return modifiedText;
    }
}
