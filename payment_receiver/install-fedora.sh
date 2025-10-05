#!/bin/bash

# Installation script for Fedora/RHEL systems

echo "=== Installing Solana Development Dependencies on Fedora ==="

# Install build dependencies
echo "Installing build dependencies..."
sudo dnf groupinstall -y "Development Tools"
sudo dnf install -y \
  pkg-config \
  systemd-devel \
  llvm \
  clang \
  protobuf-compiler \
  openssl-devel \
  curl \
  git

echo "✅ Build dependencies installed"

# Rust is already installed, verify
echo ""
echo "Rust version:"
export PATH="$HOME/.cargo/bin:$PATH"
rustc --version
cargo --version

# Solana CLI is already installed, verify
echo ""
echo "Solana CLI version:"
export PATH="/home/toad/.local/share/solana/install/active_release/bin:$PATH"
solana --version

# Install Anchor CLI
echo ""
echo "Installing Anchor CLI (this will take 10-15 minutes)..."
export PATH="$HOME/.cargo/bin:$PATH"
cargo install --git https://github.com/coral-xyz/anchor avm --force

if [ $? -eq 0 ]; then
    echo "✅ Anchor Version Manager installed"

    echo ""
    echo "Installing latest Anchor version..."
    avm install latest
    avm use latest

    echo ""
    echo "✅ Anchor installed successfully!"
    anchor --version
else
    echo "❌ Anchor installation failed"
    exit 1
fi

# Add to PATH permanently
echo ""
echo "Adding tools to PATH in ~/.bashrc..."
if ! grep -q 'export PATH="$HOME/.cargo/bin:$PATH"' ~/.bashrc; then
    echo 'export PATH="$HOME/.cargo/bin:$PATH"' >> ~/.bashrc
fi

if ! grep -q 'export PATH="/home/toad/.local/share/solana/install/active_release/bin:$PATH"' ~/.bashrc; then
    echo 'export PATH="/home/toad/.local/share/solana/install/active_release/bin:$PATH"' >> ~/.bashrc
fi

echo ""
echo "=== Installation Complete ==="
echo ""
echo "Required tools installed:"
echo "  ✅ Rust $(rustc --version | awk '{print $2}')"
echo "  ✅ Solana CLI $(solana --version | awk '{print $2}')"
echo "  ✅ Anchor $(anchor --version 2>/dev/null || echo 'Run: source ~/.bashrc')"
echo ""
echo "Next steps:"
echo "  1. Run: source ~/.bashrc"
echo "  2. Run: cd /home/toad/Documents/Builds/candy_rush/payment_receiver"
echo "  3. Run: ./deploy.sh"
echo ""
