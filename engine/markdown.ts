export type Block={kind:'name'|'section'|'subheading'|'bullet'|'paragraph';text:string};
export function markdownBlocks(markdown:string):Block[]{return markdown.replaceAll('\r','').split('\n').filter(l=>l.trim()).map(line=>{
 const l=line.trim();if(l.startsWith('### '))return {kind:'subheading',text:l.slice(4)};
 if(l.startsWith('## '))return {kind:'section',text:l.slice(3)};
 if(l.startsWith('# '))return {kind:'name',text:l.slice(2)};
 if(l.startsWith('- '))return {kind:'bullet',text:l.slice(2)};return {kind:'paragraph',text:l};
 });}
export function validateMarkdown(markdown:string):string{
 const text=markdown.trim();if(text.length<80||text.length>16000||!text.startsWith('# ')||/```|<[^>]*>|!\[|\]\(|^\s*[>|]|^\s*#{4,}/m.test(text))throw new Error('Please use plain resume Markdown: headings, paragraphs, and bullet points only.');
 if(text.split('\n').some(l=>l.length>1600))throw new Error('Please split long paragraphs into shorter lines.');
 if(markdownBlocks(text).filter(b=>b.kind==='name').length!==1)throw new Error('A resume needs one name heading.');
 return text;
}
