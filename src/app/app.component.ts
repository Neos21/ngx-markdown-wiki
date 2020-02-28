import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, Inject, OnInit, Renderer2 } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';

import * as marked from 'marked';

/**
 * ngx-markdown-wiki
 */
@Component({
  selector: 'app-root',
  templateUrl: './app.component.html'
})
export class AppComponent implements OnInit {
  /** タイトル */
  public title: string = 'ngx-markdown-wiki';
  /** 初期表示するファイル : 先頭の「/」は記載しない */
  public defaultPath: string = 'index.md';
  /** ナビゲーションに表示するファイル : ルートのファイルを指定すること */
  public navPath: string = 'index-nav.md';
  
  /** コンテンツ */
  public contents: SafeHtml = '<div class="loading">ページ読込中…</div>';
  /** ナビゲーション */
  public nav: SafeHtml = '<div class="loading">ナビゲーション読込中…</div>';
  
  /** 現在開いているファイルまでのパス : ルートの場合は '' になる */
  private currentBasePath: string = '';
  /** アプリ内で使用する定数 */
  private appConstants: any = {
    /** Markdown ファイルが格納されているベースパス (末尾に「/」を含めない) */
    docsPath: 'assets/docs',
    /** 他の Markdown ファイルへのリンクに付与する CSS クラス名 */
    anchorMd: 'anchor-md',
    /** 同ページ内のハッシュリンクに付与する CSS クラス名 */
    anchorHash: 'anchor-hash'
  };
  /** .nav の表示状況を管理する */
  private isShownNav: boolean = false;
  
  /**
   * コンストラクタ
   * 
   * @param router Router
   * @param domSanitizer DomSanitizer
   * @param httpClient HttpClient
   * @param renderer2 Renderer2
   * @param document Document
   */
  constructor(
    private router: Router,
    private domSanitizer: DomSanitizer,
    private httpClient: HttpClient,
    private renderer2: Renderer2,
    @Inject(DOCUMENT) private document: any
  ) { }
  
  /**
   * 初期処理 : 画面遷移監視と初期表示
   */
  public ngOnInit(): void {
    // 画面遷移を監視して処理する
    this.router.events.subscribe((event) => {
      // 「.md」を含む URL の場合、「/#」を除去してフルパスを渡して遷移する
      if(event instanceof NavigationStart && event.url.match('.md')) {
        this.showContents(event.url.replace(/^[\/#]*(.*)/g, '/$1'));
      }
      else if(event instanceof NavigationEnd) {
        // ナビゲーションを閉じスクロール位置を最上部にする
        window.scrollTo(0, 0);
        this.toggleNav(false);
        document.querySelector('.main').scrollTo(0, 0);
        document.querySelector('.nav').scrollTo(0, 0);
      }
    });
    
    // 初回アクセス時、書式に合う URL でファイルが指定されていればそのファイルを初期表示する
    // index.html で SessionStorage に location.href を格納している
    const rawInitUrl = sessionStorage.initUrl || '';
    delete sessionStorage.initUrl;
    // アプリのベース URL を取得する :  「/#」以降があった場合は除去し、「/」で終わるようにする
    const baseUrl = location.href.replace(/\/#.*/, '/');
    // SessionStorage の値からベース URL を削り、「#/」で始まる正しい URL になっているか確認する
    const initUrl = rawInitUrl.replace(baseUrl, '');
    if(initUrl.startsWith('#/') && initUrl.match('.md')) {
      // 「#/」で始まる場合は「#/」を除去し、初期表示するページとして表示する
      this.showContents(initUrl.replace(/^#\//, ''));
    }
    else {
      // 「#/」で始まらない不正なハッシュか、特に指定がなければ、指定のページを初期表示する
      // URL 正しいモノにを変更するため Router#navigate() で移動する
      this.router.navigate([''], { fragment: `/${this.defaultPath}` });
    }
    
    // ナビゲーションを表示する
    this.loadNav();
  }
  
  /**
   * Markdown 描画領域内のクリックを監視し、Markdown ファイルへのリンクだった場合遷移処理を実行する
   * 
   * @param event イベント
   */
  public onClick(event: Event): void {
    const target = event.target as any;
    if(target.classList.contains(this.appConstants.anchorMd)) {
      // 他の「.md」ファイルへのリンクの場合
      event.preventDefault();
      // パスを取得する : Markdown パース時に「#/」で始まるリンクにしているため除去しておく
      const href = target.attributes.href.nodeValue.replace(/^#/, '');
      // 「/#/【フルパス】」の形にして遷移する
      this.router.navigate([''], { fragment: href });
    }
    else if(target.classList.contains(this.appConstants.anchorHash)) {
      // ページ内リンクの場合
      event.preventDefault();
      // ハッシュを取得する : 先頭の「#」を除去する
      const hash = target.attributes.href.nodeValue.replace(/^#/, '');
      // ハッシュの要素にスクロールし、履歴を追加する
      this.scrollToElement(hash, true);
    }
  }
  
  /**
   * ナビゲーションの開閉を制御する
   * 
   * @param isShown 強制的に開く (true) or 閉じる (false) を指定できる
   */
  public toggleNav(isShown?: boolean): void {
    // 引数が指定されていれば引数に従って操作、そうでなければ現在の状態を反転させる
    this.isShownNav = isShown !== undefined ? isShown : !this.isShownNav;
    this.renderer2[this.isShownNav ? 'addClass' : 'removeClass'](this.document.body, 'show-nav');
  }
  
  /**
   * 指定のパスのファイルを表示する
   * 
   * @param rawFullPath フルパス (遷移先ページのハッシュが混じっていることがある ex. 'hoge/fuga.md#hash)
   */
  private showContents(rawFullPath: string): void {
    // ハッシュがあれば取得しておく (「#」は除去する)
    const hash = rawFullPath.match('.md#') ? rawFullPath.replace(/.*\.md#(.*)/, '$1') : null;
    // フルパス : ハッシュが付いていた場合はハッシュを取り除いて控えておく
    const fullPath = hash ? rawFullPath.replace(/(.*)\.md#.*/, '$1.md') : rawFullPath;
    // ファイルを取得する
    this.getMarkdownFile(fullPath)
      .then((markdown) => {
        // 先に現在のページのベースパスを控えておく (コレをベースに Marked パース内で絶対パス変換するため)
        this.currentBasePath = this.detectNextBasePath(fullPath);
        // Marked で変換する
        const html = this.parseMarkdown(markdown);
        // 置換したコンテンツを埋め込む
        this.contents = this.domSanitizer.bypassSecurityTrustHtml(html);
        // ハッシュがある場合、スムーズスクロールする (要素が存在する状態にするため少し処理を遅らせる)
        if(hash) { setTimeout(() => { this.scrollToElement(hash); }, 10); }
      })
      .catch((error) => {
        this.contents = `
          <div class="error">
            <h1>404 Not Found</h1>
            <p><code>${fullPath}</code> は見つかりませんでした。</p>
          </div>
        `;
        console.log(error);
      });
  }
  
  /**
   * ナビゲーション用ファイルを読み込む
   */
  private loadNav(): void {
    // ファイルが指定されていない場合は非表示にする
    if(!this.navPath) {
      this.nav = '<span class="hidden">ナビゲーションファイルなし</span>';
      return;
    }
    
    this.getMarkdownFile(this.navPath)
      .then((markdown) => {
        const html = this.parseMarkdown(markdown);
        this.nav = this.domSanitizer.bypassSecurityTrustHtml(html);
      })
      .catch((error) => {
        this.nav = '<strong class="error">ナビゲーションファイルの読み込みに失敗</strong>';
        console.log(error);
      });
  }
  
  /**
   * HttpClient を利用して Markdown ファイルを取得する
   * 
   * @param fullPath ドキュメントのベースパスに続くファイルのフルパス
   * @return 取得結果テキスト
   */
  private getMarkdownFile(fullPath: string): Promise<any> {
    return this.httpClient.get(`${this.appConstants.docsPath}/${fullPath}`, { responseType: 'text' }).toPromise();
  }
  
  /**
   * フルパスからファイル部分を除去し、ベースパスを求める
   * 
   * @param fullPath フルパス
   * @return ベースパス (ルートの場合は '' になる)
   */
  private detectNextBasePath(fullPath: string): string {
    const nextFullPathBaseArray = fullPath.split('/');
    nextFullPathBaseArray.pop();
    const nextFullPathBase = nextFullPathBaseArray.join('/');
    return nextFullPathBase;
  }
  
  /**
   * Marked で変換する
   * 
   * @param markdown Markdown テキスト
   * @return HTML 変換結果
   */
  private parseMarkdown(markdown: string): string {
    const html = marked(markdown)
      // <a href="./example.md#example"> 部分を <a href="#/example.md#example" class="anchor-md"> に置換する
      .replace(/\<a href\=\"(?!http.?\:\/\/|ftp\:\/\/|file\:\/\/)(.*?)\.md(.*?)\"\>/g, (match, path, hash) => {
        const fullPath = this.detectNextFullPath(path);
        return `<a href="${fullPath}.md${hash}" class="${this.appConstants.anchorMd}">`;
      })
      // <a href="#example"> 部分を <a href="#example" class="anchor-hash"> に置換する
      .replace(/\<a href\=\"#(.*?)\"\>/g, `<a href="#$1" class="${this.appConstants.anchorHash}">`);
    return html;
  }
  
  /**
   * 引数の相対パスと、現在の画面の情報から、引数の絶対パスを導く
   * 
   * @param hrefStr 生のリンク URL
   * @return 引数の絶対パス (「#/」から始まる)
   */
  private detectNextFullPath(hrefStr: string): string {
    // 同階層の「./」で始まっている場合は除去しておく
    const flatLinkPath = hrefStr.replace(/^\.\//, '');
    // 「../」の数 = 遡る数を求める (「../../hoge/../fuga/foo.md」のようにパスの間に「../」が入っている場合は誤検知する)
    const pathUpCountArray = flatLinkPath.match(/\.\.\//g);
    // match() は1つもヒットしないと null になるので判定しておく
    const pathUpCount = pathUpCountArray ? pathUpCountArray.length : 0;
    // 現在表示中のパスから、遡る数だけパスを削る
    const currentBasePathArray = this.currentBasePath.split('/');
    currentBasePathArray.splice(currentBasePathArray.length - pathUpCount, pathUpCount);
    currentBasePathArray.shift();
    // 次のパスのベースを作る : 末尾が「/」で終わるよう調整
    const nextFullPathBase = currentBasePathArray.length ? `${currentBasePathArray.join('/')}/` : '';
    // パスから「../」を除去し、ベースと結合してフルパスを作る
    let nextFullPath = nextFullPathBase + flatLinkPath.replace(/\.\.\//g, '');
    // フルパスは「#/」から始まるようにする
    nextFullPath = `#${nextFullPath.replace(/^(\/)*/g, '/')}`;
    return nextFullPath;
  }
  
  /**
   * 指定のハッシュの要素にスクロールする
   * 
   * @param hash ハッシュ (先頭の「#」は除去しておく)
   * @param pushState 履歴を追加する場合は true を指定する
   */
  private scrollToElement(hash: string, pushState ?: boolean): void {
    // ハッシュ値を ID に持つ要素を探す
    const element = document.getElementById(hash);
    // なければ終了
    if(!element) { return; }
    // 要素があればスムーズスクロールする
    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // 必要であればハッシュ付きの URL を履歴に追加する : 現在のパスの「.md」以降を指定のハッシュに差し替える
    if(pushState) {
      history.pushState(null, null, `${location.href.replace(/\.md#.*/, '.md')}#${hash}`);
    }
  }
}
