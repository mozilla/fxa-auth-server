# Cleanup
yum -y clean all
rm -rf /tmp/*

# Zero free space for much compression
dd if=/dev/zero of=/EMPTY bs=1M
rm -f /EMPTY

# Ensure /EMPTY is deleted before ending
# See https://github.com/mitchellh/packer/issues/57#issuecomment-24793068
sync
sync
sync
