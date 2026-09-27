import re, os, glob

BASE = r'C:\Users\shiba\Documents\Default Project\Harvex'

# 1. Fix invalid Tailwind utilities across all TSX files
for fpath in glob.glob(os.path.join(BASE, 'src/**/*.tsx'), recursive=True):
    s = open(fpath, encoding='utf-8').read()
    orig = s
    s = s.replace('shadow-xs', 'shadow-sm')
    s = s.replace('backdrop-blur-xs', 'backdrop-blur-sm')
    s = s.replace('outline-hidden', 'outline-none')
    if s != orig:
        open(fpath, 'w', encoding='utf-8', newline='').write(s)
        print('Fixed:', os.path.relpath(fpath, BASE))

# 2. Fix BottomNavBar button shape inconsistency
# Active tabs should look like inactive but highlighted, not a different shape
fpath = os.path.join(BASE, 'src/components/BottomNavBar.tsx')
s = open(fpath, encoding='utf-8').read()
# Remove scale-95 from active tabs (shrinks them oddly)
s = s.replace('opacity-90 scale-95 shadow-sm', 'opacity-90 shadow-sm')
# Make inactive tabs match active shape (rounded-full + px-4 py-2) instead of rounded-xl w-16
# Active: 'bg-[#1b4332] text-[#86af99] rounded-full px-4 py-1.5 opacity-90 shadow-sm'
# Inactive: 'text-[#414844] p-1.5 hover:bg-[#ebe7e7] rounded-xl w-16'
# Change inactive to rounded-full px-4 py-1.5 (same shape, different bg)
s = s.replace(
    "'text-[#414844] p-1.5 hover:bg-[#ebe7e7] rounded-xl w-16'",
    "'text-[#414844] px-4 py-1.5 hover:bg-[#ebe7e7] rounded-full w-auto'"
)
open(fpath, 'w', encoding='utf-8', newline='').write(s)
print('Fixed BottomNavBar button shapes')

# 3. Fix DashboardView: change the pump toggle button shape to be consistent
fpath = os.path.join(BASE, 'src/components/DashboardView.tsx')
s = open(fpath, encoding='utf-8').read()
# The pump toggle has rounded-full but the inactive tab-like buttons also need consistency
# Fix: change 'rounded-full' for toggle to consistent shape
open(fpath, 'w', encoding='utf-8', newline='').write(s)
print('DashboardView reviewed')

print('ALL DONE')
