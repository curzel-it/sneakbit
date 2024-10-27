import UIKit

extension UIImage {
    func cropped(keepArea: CGRect) -> UIImage? {
        guard let cgImage else { return nil }
        
        let imageBounds = CGRect(
            x: 0,
            y: 0,
            width: CGFloat(cgImage.width),
            height: CGFloat(cgImage.height)
        )
        guard imageBounds.contains(keepArea) else { return nil }
        guard let croppedCGImage = cgImage.cropping(to: keepArea) else { return nil }
        
        let croppedImage = UIImage(
            cgImage: croppedCGImage,
            scale: scale,
            orientation: imageOrientation
        )
        return croppedImage
    }
}

extension UIImage {
    func flipVertically() -> UIImage? {
        UIGraphicsBeginImageContextWithOptions(size, false, scale)
        let context = UIGraphicsGetCurrentContext()!
        
        context.translateBy(x: size.width/2, y: size.height/2)
        context.scaleBy(x: 1.0, y: -1.0)
        context.translateBy(x: -size.width/2, y: -size.height/2)
        
        draw(in: CGRect(x: 0, y: 0, width: size.width, height: size.height))
        
        let newImage = UIGraphicsGetImageFromCurrentImageContext()
        UIGraphicsEndImageContext()        
        return newImage
    }
}
