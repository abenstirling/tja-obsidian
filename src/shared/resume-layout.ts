import {markdownBlocks,validateMarkdown,type Block} from './markdown';
import {fonts,measure,wrap,type ResumeFont} from './resume-font';
import {layoutPlumeria} from './plumeria-layout';
import {layoutPepperdine} from './pepperdine-layout';
import type {ResumeTemplateId} from './resume-templates';
export type {ResumeFont} from './resume-font';

// Fixed one-page layout. All dimensions are PDF points.
export const RESUME_PAGE={width:612,height:792,top:32.4,right:46.8,bottom:36,left:46.8} as const;
export type ResumeLine={text:string;x:number;y:number;size:number;font:ResumeFont;color:string;width:number;sourceLine:number;top:number;bottom:number;left:number;right:number};
export type ResumeRule={x:number;y:number;width:number;weight?:number;color?:string};
export type LintIssue={code:'markdown'|'overflow'|'glyph'|'underfill';message:string;line?:number;severity:'error'|'warning'};
export type ResumeLayout={template:ResumeTemplateId;page:{width:number;height:number;top:number;right:number;bottom:number;left:number};lines:ResumeLine[];rules:ResumeRule[];issues:LintIssue[];ok:boolean;bottom:number;overflow:number};
export function resumeText(text:string){return text.normalize('NFC').replace(/\*\*/g,'').replace(/[–—‑−]/g,'-').replace(/\t/g,' ').replace(/\u00a0/g,' ');}
export function layoutResume(markdown:string,template:ResumeTemplateId='classic'):ResumeLayout{
 if(template==='plumeria')return layoutPlumeria(markdown);
 if(template==='pepperdine')return layoutPepperdine(markdown);
 const issues:LintIssue[]=[],lines:ResumeLine[]=[],rules:ResumeRule[]=[];
 try{validateMarkdown(markdown);}catch(e){issues.push({code:'markdown',severity:'error',message:(e as Error).message});}
 let sourceLine=0;const rawLines=markdown.split('\n');
 const blocks=markdownBlocks(markdown).map(block=>{
  while(sourceLine<rawLines.length&&!rawLines[sourceLine].trim())sourceLine++;
  return {...block,text:resumeText(block.text),sourceLine:++sourceLine};
 });
 type SourceBlock=Block&{sourceLine:number};
 const contact:SourceBlock[]=[],body:SourceBlock[]=[];let inContact=false,beforeSection=true;
 for(const block of blocks){
  if(block.kind==='section'){inContact=block.text.toLowerCase()==='contact';beforeSection=false;if(inContact)continue;}
  if(inContact||(beforeSection&&block.kind==='paragraph'&&/[@]|https?:\/\/|www\./i.test(block.text)))contact.push(block);else body.push(block);
 }
 let y=RESUME_PAGE.top;const usable=RESUME_PAGE.width-RESUME_PAGE.left-RESUME_PAGE.right;
 function add(block:SourceBlock,contactLine=false){
  const name=block.kind==='name',section=block.kind==='section',sub=block.kind==='subheading',bullet=block.kind==='bullet'&&!contactLine;
  const size=contactLine?9.5:name?25:section?13.5:10.25,font:ResumeFont=contactLine?'italic':sub?'bold':'normal',leading=size*(contactLine?1.3:1.25);
  if(!contactLine&&section)y+=9.5;else if(!contactLine&&sub)y+=3.5;
  const indent=bullet?11:section?40.6:0;
  for(const char of block.text)if(!fonts[font][char.codePointAt(0)!]){if(!issues.some(issue=>issue.code==='glyph'))issues.push({code:'glyph',severity:'error',line:block.sourceLine,message:'This template cannot render one or more characters. Replace unsupported symbols before downloading.'});break;}
  const wrapped=wrap(block.text,font,size,usable-indent-2);
  if(section)rules.push({x:RESUME_PAGE.left,y:y+size*.62,width:39.6});
  for(const [index,text] of wrapped.entries()){
   const m=measure(text,font,size),x=contactLine?RESUME_PAGE.width-RESUME_PAGE.right-m.width-2:RESUME_PAGE.left+indent;
   // A fixed line box keeps body size and spacing constant; no automatic shrinking.
   const baseline=y+size*.96;
   lines.push({text,x,y:baseline,size,font,color:section?'#5fa8d3':'#000000',width:m.width,sourceLine:block.sourceLine,top:baseline-Math.max(m.ascent,size*.9),bottom:baseline+Math.max(m.descent,size*.23),left:x+m.left,right:x+m.right});
   if(bullet&&index===0){const m=measure('•','normal',size);lines.push({text:'•',x:RESUME_PAGE.left,y:baseline,size,font:'normal',color:'#000000',width:m.width,sourceLine:block.sourceLine,top:baseline-Math.max(m.ascent,size*.9),bottom:baseline+Math.max(m.descent,size*.23),left:RESUME_PAGE.left,right:RESUME_PAGE.left+m.right});}
   y+=leading;
  }
  y+=contactLine?2:name?4:section?3.5:5.25;
 }
 contact.forEach(block=>add(block,true));body.forEach(block=>add(block));
 const bottom=Math.max(RESUME_PAGE.top,...lines.map(line=>line.bottom)),limit=RESUME_PAGE.height-RESUME_PAGE.bottom,overflow=Math.max(0,bottom-limit);
 const offending=lines.find(line=>line.bottom>limit+.01||line.top<RESUME_PAGE.top-.01||line.left<RESUME_PAGE.left-.01||line.right>RESUME_PAGE.width-RESUME_PAGE.right+.01);
 if(offending)issues.push({code:'overflow',severity:'error',line:offending.sourceLine,message:overflow>0?`Over the one-page limit by ${Math.ceil(overflow/12.8125)} lines with the required 0.5-inch bottom margin. Shorten or remove details before downloading.`:'Text exceeds the page margins. Shorten this line before downloading.'});
 // The reference script flags large empty areas below y=690. Keep this advisory:
 // a short, truthful resume is valid and must not be padded with invented details.
 if(bottom<690&&!offending)issues.push({code:'underfill',severity:'warning',message:'There is room for more relevant experience, if you have it.'});
 return {template:'classic',page:RESUME_PAGE,lines,rules,issues,ok:!issues.some(issue=>issue.severity==='error'),bottom,overflow};
}
export function assertResumeFits(markdown:string,template:ResumeTemplateId='classic'){const layout=layoutResume(markdown,template);const error=layout.issues.find(issue=>issue.severity==='error');if(error)throw new Error(error.message);return layout;}
