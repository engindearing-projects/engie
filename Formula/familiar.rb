class Familiar < Formula
  desc "AI that lives in your terminal - local-first, always learning"
  homepage "https://familiar.run"
  version "1.0.0"
  license "MIT"

  if Hardware::CPU.arm?
    url "https://github.com/engindearing-projects/engie/releases/download/v1.0.0/familiar-1.0.0-macos-arm64.tar.gz"
    sha256 "PLACEHOLDER"
  else
    url "https://github.com/engindearing-projects/engie/releases/download/v1.0.0/familiar-1.0.0-macos-x64.tar.gz"
    sha256 "PLACEHOLDER"
  end

  def install
    bin.install Dir["familiar-*"].first => "familiar"
  end

  test do
    assert_match "1.0.0", shell_output("#{bin}/familiar --version")
  end
end
