import Foundation
import AppKit
import Vision
import PDFKit
func recognize(_ image: CGImage) throws -> String {
 let request = VNRecognizeTextRequest()
 request.recognitionLevel = .accurate
 request.recognitionLanguages = ["zh-Hans", "en-US"]
 request.usesLanguageCorrection = true
 try VNImageRequestHandler(cgImage: image).perform([request])
 return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
}
do {
 guard CommandLine.arguments.count == 2 else { throw NSError(domain:"reader",code:1,userInfo:[NSLocalizedDescriptionKey:"Missing file"]) }
 let url=URL(fileURLWithPath:CommandLine.arguments[1])
 if url.pathExtension.lowercased() == "pdf" {
  guard let pdf=PDFDocument(url:url), !pdf.isLocked else { throw NSError(domain:"reader",code:2,userInfo:[NSLocalizedDescriptionKey:"PDF 无法打开或已加密"]) }
  for i in 0..<pdf.pageCount {
   guard let page=pdf.page(at:i) else { continue }
   var text=page.string ?? ""
   if text.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty {
    let thumb=page.thumbnail(of:NSSize(width:1800,height:2400),for:.mediaBox)
    if let cg=thumb.cgImage(forProposedRect:nil,context:nil,hints:nil){text=try recognize(cg)}
   }
   print("\n[第 \(i+1) 页]\n\(text)")
  }
 } else {
  guard let img=NSImage(contentsOf:url),let cg=img.cgImage(forProposedRect:nil,context:nil,hints:nil) else { throw NSError(domain:"reader",code:3,userInfo:[NSLocalizedDescriptionKey:"无法读取图片"]) }
  print(try recognize(cg))
 }
} catch { FileHandle.standardError.write(Data(error.localizedDescription.utf8));exit(1) }
