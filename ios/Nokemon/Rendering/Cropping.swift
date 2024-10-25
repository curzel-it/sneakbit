import UIKit

extension UIImage {
    /// Crops the image to the specified CGRect.
    /// - Parameter keepArea: The CGRect area to keep (in pixels).
    /// - Returns: A new UIImage cropped to `keepArea` if it's within bounds, otherwise `nil`.
    func cropped(keepArea: CGRect) -> UIImage? {
        // Ensure the image has a CGImage backing
        guard let cgImage = self.cgImage else {
            print("Failed to get cgImage from UIImage.")
            return nil
        }
        
        // Calculate the image's pixel dimensions
        let imageWidth = CGFloat(cgImage.width)
        let imageHeight = CGFloat(cgImage.height)
        
        // Define the bounds of the image
        let imageBounds = CGRect(x: 0, y: 0, width: imageWidth, height: imageHeight)
        
        // Check if the keepArea is entirely within the image bounds
        guard imageBounds.contains(keepArea) else {
            print("The cropping rectangle \(keepArea) is out of the image bounds \(imageBounds).")
            return nil
        }
        
        // Perform the cropping
        guard let croppedCGImage = cgImage.cropping(to: keepArea) else {
            print("Failed to crop the CGImage with the specified area.")
            return nil
        }
        
        // Create and return a new UIImage from the cropped CGImage
        let croppedImage = UIImage(cgImage: croppedCGImage, scale: self.scale, orientation: self.imageOrientation)
        return croppedImage
    }
}
