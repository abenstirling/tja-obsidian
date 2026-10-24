import {jsPDF} from 'jspdf';
import {RESUME_PAGE} from './resume-layout';
import {resumePages} from './resume-pagination';
import type {ResumeTemplateId} from './resume-templates';
export type ResumeFonts=[string,string,string,string?,string?];
// The shared layout is the linter, preview and generation check's single source of truth.
// Browser memory only: generated PDF bytes are never sent to our server or an AI service.
export function createPDF(markdown:string,fontData:ResumeFonts,template:ResumeTemplateId='classic',enforceOnePage=true,accentColor?:string){
 const pages=resumePages(markdown,template,enforceOnePage,accentColor);
 const error=pages[0].issues.find(issue=>issue.severity==='error');if(error)throw new Error(error.message);
 const selectedFonts=template==='plumeria'?[fontData[3],fontData[4],fontData[3]]:fontData;
 if(selectedFonts.slice(0,3).some(font=>!font))throw new Error('The template font could not load.');
 const doc=new jsPDF({unit:'pt',format:'letter',putOnlyUsedFonts:true,compress:true});
 for(const [i,style] of ['normal','bold','italic'].entries()){
  const file=`Resume-${style}.ttf`;doc.addFileToVFS(file,selectedFonts[i]!);doc.addFont(file,'Resume',style);
 }
 for(const [index,layout] of pages.entries()){
 if(index)doc.addPage('letter');
 for(const rule of layout.rules){doc.setDrawColor(rule.color||'#3a3a3a');doc.setLineWidth(rule.weight||1.2);doc.line(rule.x,rule.y,rule.x+rule.width,rule.y);}
 for(const line of layout.lines){doc.setFont('Resume',line.font);doc.setFontSize(line.size);doc.setTextColor(line.color);doc.text(line.text,line.x,line.y);}
 }
 // A second structural guard prevents future renderer changes from bypassing the linter.
 if((enforceOnePage&&doc.getNumberOfPages()!==1)||doc.internal.pageSize.getWidth()!==RESUME_PAGE.width||doc.internal.pageSize.getHeight()!==RESUME_PAGE.height)throw new Error('PDF must be exactly one US Letter page.');
 return doc;
}
